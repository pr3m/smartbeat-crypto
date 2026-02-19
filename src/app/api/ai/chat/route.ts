/**
 * AI Chat API Route
 * POST /api/ai/chat - Streaming chat with function calling
 */

import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { prisma } from '@/lib/db';
import { assistantTools, executeTool, type ToolName } from '@/lib/ai/tools';
import { trackAIUsage } from '@/lib/ai/usage-tracker';
import { buildStrategySystemPrompt, buildTradingContextThresholds } from '@/lib/ai/strategy-prompt-builder';

function buildSystemPrompt(): string {
  const strategySection = buildStrategySystemPrompt();

  return `You are SmartBeat Assistant, an AI helper for the SmartBeatCrypto trading application.

${strategySection}

**CRITICAL: Proactive Tool Usage for Market Data**
- For ANY trading question (price, setup, analysis, entry/exit levels, DCA), you MUST call tools to get current data
- NEVER ask the user for the current price - use \`get_market_data\` to fetch it yourself
- NEVER guess or assume prices - always fetch live data first
- The user expects you to have access to real-time market data through your tools

**Required Tools for Trading Questions:**
- \`get_market_data\`: Get current price, 24h stats, and indicators - USE THIS FIRST for any price-related question
- \`get_current_setup\`: Get the entry checklist showing which conditions are passing for LONG/SHORT
- \`get_trading_recommendation\`: Get full multi-timeframe analysis with action recommendation
- \`get_positions\`: Get open positions with entry prices and P&L
- \`get_ohlc_data\`: Get candlestick data for specific timeframe analysis
- \`get_strategy_config\`: Get current strategy configuration (weights, thresholds, DCA rules, exit rules)
- \`get_v2_engine_state\`: Get v2 engine state (DCA signal, exit signal, timebox status, anti-greed, position sizing)
- \`get_fear_greed\`: Bitcoin Fear & Greed Index for market sentiment
- \`get_funding_and_oi\`: Derivatives data — funding rates, open interest, market bias
- \`get_rollover_costs\`: Actual rollover/financing costs for open positions
- \`get_trading_session\`: Current trading session (Asia/EU/US) and market hours
- \`get_position_health\`: Comprehensive position risk using Kraken cross-margin liquidation formulas
- \`get_trading_history\`: Past closed trades with P&L, win rate, performance stats

**Tool Usage Pattern:**
1. For "what's the price?" or "where are we?" → call \`get_market_data\`
2. For "should I go long/short?" → call \`get_current_setup\` or \`get_trading_recommendation\`
3. For "should I DCA?" or "should I add?" → call \`get_v2_engine_state\` to check momentum exhaustion signals
4. For "should I exit?" or "should I close?" → call \`get_v2_engine_state\` to check exit pressure
5. For "how's my position?" → call \`get_positions\` then \`get_v2_engine_state\`
6. For "what's the strategy?" → call \`get_strategy_config\`
7. NEVER output JSON tool calls as text - use actual function calling
8. For "what would my average be if I buy at X?" or "how much to buy to get average to X?" or "DCA scenarios" → call \`dca_scenario_planner\`
   - NEVER attempt manual math for DCA scenarios — ALWAYS use the dca_scenario_planner tool
9. For market sentiment → call \`get_fear_greed\`
10. For funding rates, open interest, liquidation bias → call \`get_funding_and_oi\`
11. For rollover/holding costs on a position → call \`get_rollover_costs\`
12. For current trading session (Asia/EU/US) → call \`get_trading_session\`
13. For position health, liquidation risk, margin level → call \`get_position_health\`
14. For past trade history, win rate → call \`get_trading_history\`

**Response Format:**
- Be direct and concise
- Format: €1,234.56 for money, +/- for P&L
- When discussing trades, always mention both long AND short potential
- NEVER suggest stop losses, trailing stops, or fixed take-profit levels
- NEVER suggest exiting at a loss
- Reference timebox status for position timing questions

**Current Context:**
{context}

Remember: You have full access to live market data and strategy configuration through tools. Use them proactively.`;
}

interface ChatRequest {
  conversationId?: string | null;
  message: string;
  context: 'general' | 'trading' | 'tax' | 'transactions';
  tradingMode?: 'paper' | 'live';
}

export async function POST(request: NextRequest) {
  // Check OpenAI configuration
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    return Response.json(
      { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env' },
      { status: 500 }
    );
  }

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  console.log('Chat API using model:', model);

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { conversationId, message, context, tradingMode = 'paper' } = body;

  if (!message?.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }

  // Create streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper to send SSE data
  const send = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // Process chat in background
  (async () => {
    const startTime = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let conversationIdForTracking: string | null = null;

    // Send initial event to confirm connection
    await send({ type: 'status', message: 'Processing...' });

    try {
      // Get or create conversation
      let conversation;
      let isNewConversation = false;

      if (conversationId) {
        conversation = await prisma.chatConversation.findUnique({
          where: { id: conversationId },
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
        });
      }

      if (!conversation) {
        conversation = await prisma.chatConversation.create({
          data: {
            context,
            title: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
          },
          include: { messages: true },
        });
        isNewConversation = true;

        // Send new conversation ID
        await send({ type: 'conversation', id: conversation.id });
      }

      conversationIdForTracking = conversation.id;

      // Save user message
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message,
        },
      });

      // Build context string
      const contextInfo = buildContextInfo(context, tradingMode);

      // Build messages for OpenAI
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: buildSystemPrompt().replace('{context}', contextInfo),
        },
      ];

      // Add conversation history (last 30 messages)
      // Skip tool-role messages and assistant messages with tool_calls — they were
      // only needed during the original request. Including them in history risks
      // orphaned tool messages (if the window slices off their parent assistant
      // message), which causes OpenAI 400 errors.
      for (const msg of conversation.messages.slice(-30)) {
        if (msg.role === 'user') {
          messages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          // Skip intermediate assistant messages that only had tool calls (no text)
          if (msg.toolCalls && !msg.content?.trim()) {
            continue;
          }
          // For assistant messages with both text and tool calls, keep only the text
          messages.push({ role: 'assistant', content: msg.content });
        }
        // Skip tool-role messages entirely — they're not needed for context
      }

      // Add current message
      messages.push({ role: 'user', content: message });

      // Multi-round tool call loop
      // The model may need multiple rounds: e.g., get positions first, then analyze them
      const MAX_TOOL_ROUNDS = 5;
      let fullResponse = '';
      let totalToolCalls = 0;
      let totalDbMessages = 1; // Start at 1 for the user message already saved
      let toolRound = 0;
      let needsMoreToolCalls = true;

      while (needsMoreToolCalls && toolRound < MAX_TOOL_ROUNDS) {
        toolRound++;
        const roundToolCalls: { id: string; name: string; arguments: string }[] = [];
        let roundContent = '';

        const response = await openai.chat.completions.create({
          model,
          messages,
          tools: assistantTools,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        });

        let currentToolCall: { id: string; name: string; arguments: string } | null = null;

        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta;

          // Track usage from final chunk
          if (chunk.usage) {
            totalInputTokens += chunk.usage.prompt_tokens || 0;
            totalOutputTokens += chunk.usage.completion_tokens || 0;
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              if (toolCall.id) {
                // New tool call starting
                if (currentToolCall) {
                  roundToolCalls.push(currentToolCall);
                }
                currentToolCall = {
                  id: toolCall.id,
                  name: toolCall.function?.name || '',
                  arguments: toolCall.function?.arguments || '',
                };
                await send({ type: 'tool_start', name: currentToolCall.name });
              } else if (currentToolCall && toolCall.function?.arguments) {
                // Continuing arguments
                currentToolCall.arguments += toolCall.function.arguments;
              }
            }
          }

          // Handle content
          if (delta?.content) {
            roundContent += delta.content;
            await send({ type: 'text', content: delta.content });
          }
        }

        // Save final tool call if exists
        if (currentToolCall) {
          roundToolCalls.push(currentToolCall);
        }

        // If no tool calls this round, we're done
        if (roundToolCalls.length === 0) {
          fullResponse = roundContent;
          needsMoreToolCalls = false;

          // Detect if model output JSON tool call as text (bad behavior)
          if (fullResponse.trim()) {
            const jsonMatch = fullResponse.match(/^\s*\{[\s\S]*"toolCall"[\s\S]*\}\s*$/);
            if (jsonMatch) {
              console.warn('Model output tool call as text instead of using tools:', fullResponse);
              fullResponse = "I apologize, but I encountered an issue processing your request. Let me try again.";
              await send({ type: 'text', content: "\n\nPlease rephrase your question and I'll help you." });
            }
          }
          break;
        }

        // Tool calls found — execute them
        totalToolCalls += roundToolCalls.length;

        // Add assistant message with tool calls to in-memory conversation
        messages.push({
          role: 'assistant',
          content: roundContent || null,
          tool_calls: roundToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Save assistant message with tool calls to DB BEFORE tool results
        // This ensures correct ordering: assistant(tool_calls) -> tool results
        await prisma.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: roundContent || '',
            toolCalls: JSON.stringify(roundToolCalls),
          },
        });
        totalDbMessages++;

        // Execute each tool and save results to DB for conversation history
        for (const toolCall of roundToolCalls) {
          let toolResultContent: string;
          try {
            const args = JSON.parse(toolCall.arguments || '{}');
            console.log(`[Round ${toolRound}] Executing tool: ${toolCall.name}`, args);
            const result = await executeTool(toolCall.name as ToolName, args);
            console.log(`[Round ${toolRound}] Tool ${toolCall.name} result success:`, (result as { success?: boolean }).success);

            await send({ type: 'tool_end', name: toolCall.name });

            // Stringify result, but limit size to avoid context overflow
            const resultStr = JSON.stringify(result);
            toolResultContent = resultStr.length > 30000
              ? JSON.stringify({ success: true, data: { note: 'Response truncated due to size', preview: resultStr.slice(0, 2000) + '...' } })
              : resultStr;
          } catch (toolError) {
            console.error(`[Round ${toolRound}] Tool ${toolCall.name} error:`, toolError);
            await send({ type: 'tool_end', name: toolCall.name });

            toolResultContent = JSON.stringify({
              success: false,
              error: toolError instanceof Error ? toolError.message : 'Tool execution failed',
            });
          }

          // Add tool result to messages for the model
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent,
          });

          // Save tool result to DB for conversation history continuity
          await prisma.chatMessage.create({
            data: {
              conversationId: conversation.id,
              role: 'tool',
              content: toolResultContent,
              toolCallId: toolCall.id,
              name: toolCall.name,
            },
          });
          totalDbMessages++;
        }

        // Continue the loop — the next iteration will send tool results back
        // to the model, which can then call more tools or generate a response
      }

      // Safety: if the loop ended without a text response (all rounds were tool calls)
      if (!fullResponse.trim() && totalToolCalls > 0) {
        try {
          // One final call to generate the response (with tools available in case model still needs data)
          const finalResponse = await openai.chat.completions.create({
            model,
            messages,
            tools: assistantTools,
            tool_choice: 'none', // Force text response, no more tools
            stream: true,
            stream_options: { include_usage: true },
          });

          for await (const chunk of finalResponse) {
            if (chunk.usage) {
              totalInputTokens += chunk.usage.prompt_tokens || 0;
              totalOutputTokens += chunk.usage.completion_tokens || 0;
            }
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              await send({ type: 'text', content });
            }
          }
        } catch (finalError) {
          console.error('Final response generation error:', finalError);
          fullResponse = `I gathered the data but encountered an error generating a response: ${finalError instanceof Error ? finalError.message : 'Unknown error'}. Please try again.`;
          await send({ type: 'text', content: fullResponse });
        }
      }

      // Final safety: still no response
      if (!fullResponse.trim()) {
        fullResponse = 'I processed the data but the AI model returned an empty response. This can happen due to rate limits or content filters. Please try again.';
        await send({ type: 'text', content: fullResponse });
      }

      // Save final assistant text response to DB
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: fullResponse,
        },
      });
      totalDbMessages++;

      // Update conversation message count
      const totalNewMessages = totalDbMessages;
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: totalNewMessages },
          updatedAt: new Date(),
        },
      });

      await send({ type: 'done' });

      // Track AI usage
      const durationMs = Date.now() - startTime;
      await trackAIUsage({
        feature: 'chat',
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        conversationId: conversationIdForTracking || undefined,
        success: true,
        durationMs,
        endpoint: '/api/ai/chat',
        userContext: context,
      });
    } catch (error) {
      console.error('Chat API error:', error);
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : 'An error occurred',
      });

      // Track failed request
      const durationMs = Date.now() - startTime;
      await trackAIUsage({
        feature: 'chat',
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        conversationId: conversationIdForTracking || undefined,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
        endpoint: '/api/ai/chat',
        userContext: context,
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function buildContextInfo(context: string, tradingMode: 'paper' | 'live' = 'paper'): string {
  const now = new Date();
  const year = now.getFullYear();
  const isPaper = tradingMode === 'paper';
  const modeLabel = isPaper ? 'Paper Trading (Test Mode)' : 'Live Trading (Real Money)';
  const positionType = isPaper ? 'simulated' : 'kraken';
  const balanceType = isPaper ? 'simulated' : 'kraken';

  switch (context) {
    case 'trading':
      return `User is viewing the Trading dashboard for XRP/EUR trading.

**TRADING MODE: ${modeLabel}**
- The user is currently in **${modeLabel}** mode
- When fetching positions, use \`get_positions\` with type="${positionType}" (NOT "all")
- When fetching balance, use \`get_balance\` with type="${balanceType}"
- When analyzing positions, use \`analyze_position\` with type="${positionType}"
- ${isPaper ? 'Positions and balance are simulated/paper trades stored locally' : 'Positions and balance are REAL on Kraken exchange'}

**IMPORTANT: You must fetch live data for trading questions!**
- Call \`get_market_data\` to get current XRP/EUR price and indicators
- Call \`get_current_setup\` to see which entry conditions are passing
- Call \`get_positions\` with type="${positionType}" to check open positions
- Call \`get_balance\` with type="${balanceType}" to check available margin
- Do NOT ask the user for price data - fetch it yourself using tools
- ALWAYS check positions and balance proactively when discussing trades

**When answering trading questions:**
- Always analyze BOTH long AND short setups with strength grades
- Reference the multi-timeframe analysis (1D, 4H, 1H, 15m, 5m)
- For DCA "what-if" scenarios and average price calculations, use \`dca_scenario_planner\` — NEVER do manual math
- For DCA signal/timing questions, use \`get_v2_engine_state\` - DCA is momentum exhaustion based, NOT fixed % drops
- For exit questions, use \`get_v2_engine_state\` - exits are pressure-based, NOT stop losses
- Highlight momentum alerts and spike opportunities
- Be direct about risks and invalidation levels
- NEVER suggest stop losses or fixed take-profit levels

${buildTradingContextThresholds()}`;

    case 'tax':
      return `User is viewing the Tax Reports section. They may ask about tax calculations, taxable events, or Estonian tax rules. Current tax year context: ${year}. Estonian tax rate: ${year >= 2026 ? '24%' : '22%'}.`;

    case 'transactions':
      return `User is viewing the Transactions section. They may ask about past trades, deposits, withdrawals, or specific transaction details.`;

    default:
      return `General context. User may ask about any aspect of the trading platform, tax calculations, or their transaction history. For trading questions, use tools to fetch live market data. Trading mode: ${modeLabel}. Use type="${positionType}" for positions and type="${balanceType}" for balance.`;
  }
}

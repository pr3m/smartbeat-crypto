/**
 * LangChain OpenAI Client Factory
 * Provides configured ChatOpenAI instance for all AI chains
 *
 * Supports both standard models (gpt-4o) and reasoning models (gpt-5.2, o1, o3)
 * Reasoning models require special configuration via Responses API
 */

import { ChatOpenAI } from '@langchain/openai';

let clientInstance: ChatOpenAI | null = null;
let lastModelConfig: string | null = null;

export interface ClientConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Reasoning models that require Responses API configuration
const REASONING_MODELS = ['gpt-5', 'gpt-5.2', 'o1', 'o3', 'o4'];

function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.some(rm => model.toLowerCase().startsWith(rm.toLowerCase()));
}

/**
 * Get or create a ChatOpenAI client instance
 */
export function getOpenAIClient(config: ClientConfig = {}): ChatOpenAI {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const temperature = config.temperature ?? 0.3;
  const maxTokens = config.maxTokens ?? 4000;

  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in .env');
  }

  const configKey = `${model}-${temperature}-${maxTokens}`;

  // Create new instance if config changed or not initialized
  if (!clientInstance || lastModelConfig !== configKey) {
    lastModelConfig = configKey;

    if (isReasoningModel(model)) {
      // Reasoning models (gpt-5.2, o1, o3, etc.) require Responses API
      // to extract reasoning summaries and get visible output
      clientInstance = new ChatOpenAI({
        apiKey,
        model,
        // Reasoning models don't support temperature
        // Use Responses API to get reasoning summaries in content
        useResponsesApi: true,
        // Format reasoning summaries into message content
        outputVersion: 'responses/v1',
        // Configure reasoning behavior
        reasoning: {
          effort: 'medium',  // Options: 'low', 'medium', 'high'
          summary: 'auto',   // Include reasoning summary in output
        },
        // Don't set maxTokens for reasoning models - let them use what they need
        // The model will allocate tokens between reasoning and output
      } as ConstructorParameters<typeof ChatOpenAI>[0]);
    } else {
      // Standard models (gpt-4o, gpt-4o-mini, etc.)
      clientInstance = new ChatOpenAI({
        apiKey,
        model,
        temperature,
        maxTokens,
      });
    }
  }

  return clientInstance;
}

/**
 * Create a fresh client instance (for one-off calls with different config)
 */
export function createOpenAIClient(config: ClientConfig = {}): ChatOpenAI {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const temperature = config.temperature ?? 0.3;
  const maxTokens = config.maxTokens ?? 4000;

  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in .env');
  }

  if (isReasoningModel(model)) {
    // Reasoning models configuration
    return new ChatOpenAI({
      apiKey,
      model,
      useResponsesApi: true,
      outputVersion: 'responses/v1',
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
    } as ConstructorParameters<typeof ChatOpenAI>[0]);
  }

  // Standard models configuration
  return new ChatOpenAI({
    apiKey,
    model,
    temperature,
    maxTokens,
  });
}

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  return !!apiKey && apiKey !== 'your_openai_api_key_here';
}

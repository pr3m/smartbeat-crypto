/**
 * Arena Trading Competition - Commentary System
 *
 * 90% template-based (zero LLM cost), 10% LLM-generated for dramatic moments.
 * Templates use {variable} placeholders replaced at runtime.
 */

import type { CommentaryTrigger, AgentState, ArenaEvent } from './types';
import { getGenericCommentary, getCommentaryLLMSystem, getCommentaryLLMContext } from './prompt-loader';

// ============================================================================
// GENERIC TEMPLATES (fallback when archetype templates unavailable)
// ============================================================================

export const GENERIC_TEMPLATES: Record<CommentaryTrigger, string[]> = getGenericCommentary();

// ============================================================================
// COMMENTARY GENERATION
// ============================================================================

/**
 * Generate commentary from templates.
 *
 * Uses archetype-specific templates 80% of the time (if available),
 * falls back to generic templates 20% of the time for variety.
 */
export function generateCommentary(
  trigger: CommentaryTrigger,
  variables: Record<string, string>,
  archetypeTemplates?: string[]
): string {
  let templates: string[];

  if (archetypeTemplates && archetypeTemplates.length > 0) {
    // 80% archetype, 20% generic for variety
    const useArchetype = Math.random() < 0.8;
    templates = useArchetype ? archetypeTemplates : GENERIC_TEMPLATES[trigger];
  } else {
    templates = GENERIC_TEMPLATES[trigger];
  }

  if (!templates || templates.length === 0) {
    return `${variables['name'] ?? 'Agent'} did something.`;
  }

  // Pick a random template
  const template = templates[Math.floor(Math.random() * templates.length)];

  // Replace all {variable} placeholders
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}

// ============================================================================
// LLM COMMENTARY (used sparingly for dramatic moments)
// ============================================================================

/**
 * Determine if this event warrants LLM-generated commentary.
 * Only for truly dramatic moments to keep costs near zero.
 */
export function shouldUseLLMCommentary(event: ArenaEvent): boolean {
  return (
    event.type === 'agent_death' ||
    event.type === 'face_off' ||
    event.type === 'milestone'
  );
}

/**
 * Build a prompt for the LLM to generate dramatic commentary.
 * Used only for exceptional moments (~10% of commentary).
 */
export function buildCommentaryPrompt(
  event: ArenaEvent,
  agentStates: AgentState[]
): string {
  const alive = agentStates.filter((a) => !a.isDead);
  const dead = agentStates.filter((a) => a.isDead);

  const standings = agentStates
    .sort((a, b) => a.rank - b.rank)
    .map(
      (a) =>
        `  ${a.rank}. ${a.name} - ${a.isDead ? 'DEAD' : `${a.health}% HP`}, PnL: ${a.totalPnl >= 0 ? '+' : ''}${a.totalPnl.toFixed(2)} EUR`
    )
    .join('\n');

  const context = getCommentaryLLMContext(event.type, {
    agent_name: event.agentName ?? '',
    alive_count: String(alive.length),
    dead_count: String(dead.length),
    detail: event.detail,
    title: event.title,
  });

  const system = getCommentaryLLMSystem();

  return [
    system.trim(),
    '',
    `Event: ${event.title}`,
    `Context: ${context}`,
    `Price: ${event.priceAt} EUR`,
    '',
    'Current standings:',
    standings,
    '',
    'Your commentary (one sentence):',
  ].join('\n');
}

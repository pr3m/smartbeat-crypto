/**
 * Arena Prompt Loader
 *
 * Loads all arena prompts from prompts.yaml at startup.
 * Server-side only (uses fs).
 */

import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import type { CommentaryTrigger } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface ArenaPrompts {
  agent_decision: {
    system: string;
  };
  commentary_llm: {
    system: string;
    context_templates: Record<string, string>;
  };
  personalities: Record<string, string>;
  archetype_commentary: Record<string, Record<string, string[]>>;
  generic_commentary: Record<string, string[]>;
}

// ============================================================================
// LOADER (cached singleton)
// ============================================================================

const promptsPath = path.join(process.cwd(), 'src/lib/arena/prompts.yaml');
let _prompts: ArenaPrompts | null = null;

function getPrompts(): ArenaPrompts {
  if (!_prompts) {
    _prompts = yaml.load(fs.readFileSync(promptsPath, 'utf-8')) as ArenaPrompts;
  }
  return _prompts;
}

// ============================================================================
// VARIABLE INTERPOLATION
// ============================================================================

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

// ============================================================================
// EXPORTED ACCESSORS
// ============================================================================

/**
 * Get the full agent decision system prompt with variables replaced.
 */
export function getAgentDecisionPrompt(vars: Record<string, string>): string {
  return interpolate(getPrompts().agent_decision.system, vars);
}

/**
 * Get a personality description by archetype ID.
 */
export function getPersonality(archetypeId: string): string {
  const p = getPrompts().personalities[archetypeId];
  if (!p) throw new Error(`Unknown archetype: ${archetypeId}`);
  return p;
}

/**
 * Get archetype-specific commentary templates.
 */
export function getArchetypeCommentary(archetypeId: string): Record<string, string[]> | undefined {
  return getPrompts().archetype_commentary[archetypeId];
}

/**
 * Get all archetype commentary as a full map.
 */
export function getAllArchetypeCommentary(): Record<string, Record<string, string[]>> {
  return getPrompts().archetype_commentary;
}

/**
 * Get generic commentary templates (keyed by CommentaryTrigger).
 */
export function getGenericCommentary(): Record<CommentaryTrigger, string[]> {
  return getPrompts().generic_commentary as Record<CommentaryTrigger, string[]>;
}

/**
 * Get the LLM commentary system prompt.
 */
export function getCommentaryLLMSystem(): string {
  return getPrompts().commentary_llm.system;
}

/**
 * Get a commentary LLM context template with variables replaced.
 */
export function getCommentaryLLMContext(eventType: string, vars: Record<string, string>): string {
  const template = getPrompts().commentary_llm.context_templates[eventType];
  if (!template) return vars['detail'] ?? '';
  return interpolate(template, vars);
}

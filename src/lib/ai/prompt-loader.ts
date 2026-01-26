/**
 * YAML Prompt Loader with Caching
 * Loads and caches prompt files from src/lib/ai/prompts/
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

interface PromptCache {
  content: Record<string, unknown>;
  loadedAt: number;
}

const cache: Map<string, PromptCache> = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache (for development hot-reload)

/**
 * Load a prompt file from the prompts directory
 * @param promptName - Name of the prompt file (without .yaml extension)
 * @returns Parsed prompt content
 */
export function loadPrompt<T = Record<string, unknown>>(promptName: string): T {
  const now = Date.now();
  const cached = cache.get(promptName);

  // Return cached version if still valid
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.content as T;
  }

  // Load from file
  const promptPath = path.join(process.cwd(), 'src/lib/ai/prompts', `${promptName}.yaml`);

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptName}.yaml`);
  }

  const fileContents = fs.readFileSync(promptPath, 'utf8');
  const content = yaml.load(fileContents) as Record<string, unknown>;

  // Cache the result
  cache.set(promptName, { content, loadedAt: now });

  return content as T;
}

/**
 * Clear the prompt cache (useful for testing)
 */
export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Load all prompts from the prompts directory
 */
export function loadAllPrompts(): Map<string, Record<string, unknown>> {
  const promptsDir = path.join(process.cwd(), 'src/lib/ai/prompts');
  const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.yaml'));

  const prompts = new Map<string, Record<string, unknown>>();

  for (const file of files) {
    const name = file.replace('.yaml', '');
    prompts.set(name, loadPrompt(name));
  }

  return prompts;
}

/**
 * Interpolate variables into a prompt template
 * @param template - Template string with {variable} placeholders
 * @param variables - Object with variable values
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string | number>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }

  return result;
}

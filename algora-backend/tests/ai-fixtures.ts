export const mentorAnswer = {
  diagnosis: 'The loop can reach an invalid index.', location: 'Loop condition',
  explanation: 'An array index starts at zero. Check the largest index the loop can visit.',
  question: 'What is the last valid index for a one-element array?', diagnosticTest: 'Constructed example: trace a one-element array.',
  nextAction: 'Compare the last iteration with the array length.',
};
const approach = {
  name: 'Pair enumeration', idea: 'Examine each distinct pair.', algorithm: 'Check the sum of each pair.',
  code: 'class Example { int[] find(int[] a, int t) { for (int i=0; i<a.length; i++) for (int j=i+1; j<a.length; j++) if(a[i]+a[j]==t) return new int[]{i,j}; return new int[0]; } }',
  time: 'O(n²)', space: 'O(1)', derivation: 'The nested loops enumerate n(n−1)/2 pairs.',
  difficulty: 'Beginner', suitability: 'Small arrays', tradeoffs: 'Simple but grows quadratically.',
  mistakes: 'Using the same index twice.', teachingOrder: 'First',
};
export const preparationAnswer = {
  understanding: 'Find two distinct indices. Confirm exact constraints on the official page.',
  approaches: [approach, { ...approach, name: 'Complement map', code: 'class Example { int[] find(int[] a,int t){ java.util.Map<Integer,Integer> seen=new java.util.HashMap<>(); for(int i=0;i<a.length;i++){ Integer j=seen.get(t-a[i]); if(j!=null)return new int[]{j,i}; seen.put(a[i],i); } return new int[0]; } }',
    time: 'Expected O(n)', space: 'O(n)', derivation: 'A single pass uses expected constant-time hash operations.' }],
  dryRuns: 'For [2, 7] and target 9, the first pair succeeds.',
  mistakes: 'Anticipated mistake: using the current index twice. Try input [3, 3] and target 6.',
  edgeCases: 'Constructed case: [3, 3], target 6, expected [0, 1].',
  expectedDoubts: 'Why must the two indices differ?',
  teachingGuide: 'Trace a pair, then ask how to avoid repeated work.',
  hints: ['Consider a one-element example within the requirements.', 'Observe the difference between a value and the target.', 'Think about membership queries.', 'Check when each index becomes available.'],
};
export const chapterAnswer = {
  objectives: 'Recognize complement relationships.', prerequisites: 'Arrays and loops.', patterns: 'Enumeration and indexing.',
  sequence: 'Use the existing order.', relationships: 'The tasks exercise array invariants.', difficulties: 'Distinct indices.',
  mistakes: 'Confusing values and indices.', strategy: 'Trace before coding.', questions: 'When should state be updated?',
};

export function groqFixture(system: string, input: Record<string, unknown>) {
  if (system.includes('{"ok":true}')) return { ok: true };
  if (system.includes('one string field answer')) return { answer: 'Use two distinct indices and derive the number of candidate pairs.' };
  if (system.includes('objectives, prerequisites')) return chapterAnswer;
  if (system.includes('fields understanding')) {
    const field = typeof input.section === 'string' ? input.section : undefined;
    return field && field in preparationAnswer ? { [field]: preparationAnswer[field as keyof typeof preparationAnswer] } : preparationAnswer;
  }
  return mentorAnswer;
}

export const anthropicResponse = (content: unknown, includeUsage = true) => new Response(JSON.stringify({
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(content) }],
  ...(includeUsage ? { usage: { input_tokens: 180, output_tokens: 120 } } : {}),
}), { headers: { 'Content-Type': 'application/json', 'anthropic-ratelimit-requests-remaining': '95' } });

export const groqResponse = (content: unknown, includeUsage = true) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
  ...(includeUsage ? { usage: { prompt_tokens: 180, completion_tokens: 120, total_tokens: 300 } } : {}),
}), { headers: { 'Content-Type': 'application/json', 'x-ratelimit-remaining-requests': '950', 'x-ratelimit-reset-tokens': '6.5s' } });

import * as readline from 'readline';

type Question = {
  type: 'confirm' | 'input' | 'list';
  name: string;
  message: string;
  default?: unknown;
  choices?: Array<{ name: string; value: unknown }>;
};

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer)));
}

export async function simplePrompt(qs: ReadonlyArray<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out: Record<string, unknown> = {};
  try {
    for (const raw of qs) {
      const q = raw as Question;
      if (q.type === 'confirm') {
        const def = q.default !== false;
        const answer = (await ask(rl, `${q.message} ${def ? '[Y/n]' : '[y/N]'}: `)).trim().toLowerCase();
        out[q.name] = answer === '' ? def : answer === 'y' || answer === 'yes';
      } else if (q.type === 'input') {
        const def = typeof q.default === 'string' ? q.default : '';
        const answer = (await ask(rl, def ? `${q.message} [${def}]: ` : `${q.message}: `)).trim();
        out[q.name] = answer || def;
      } else if (q.type === 'list') {
        console.log(q.message);
        const choices = q.choices ?? [];
        choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.name}`));
        while (true) {
          const answer = (await ask(rl, `Pick 1-${choices.length}: `)).trim();
          const n = Number.parseInt(answer, 10);
          if (Number.isFinite(n) && n >= 1 && n <= choices.length) {
            out[q.name] = choices[n - 1].value;
            break;
          }
        }
      }
    }
  } finally {
    rl.close();
  }
  return out;
}

import * as readline from 'readline';
import * as fs from 'fs';

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

function openTty(): { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; close: () => void } | null {
  try {
    const inFd = fs.openSync('/dev/tty', 'r');
    const outFd = fs.openSync('/dev/tty', 'w');
    const input = fs.createReadStream('', { fd: inFd, autoClose: false }) as unknown as NodeJS.ReadableStream;
    const output = fs.createWriteStream('', { fd: outFd, autoClose: false }) as unknown as NodeJS.WritableStream;
    return {
      input,
      output,
      close: () => {
        try {
          fs.closeSync(inFd);
        } catch {}
        try {
          fs.closeSync(outFd);
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

export async function simplePrompt(qs: ReadonlyArray<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const tty = openTty();
  const input = tty ? tty.input : process.stdin;
  const output = tty ? tty.output : process.stdout;
  const rl = readline.createInterface({ input, output, terminal: true });
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
        output.write(`${q.message}\n`);
        const choices = q.choices ?? [];
        choices.forEach((c, i) => output.write(`  ${i + 1}) ${c.name}\n`));
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
    if (tty) tty.close();
  }
  return out;
}

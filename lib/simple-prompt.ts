import * as fs from 'fs';

type Question = {
  type: 'confirm' | 'input' | 'list';
  name: string;
  message: string;
  default?: unknown;
  choices?: Array<{ name: string; value: unknown }>;
};

function readLineSync(fd: number): string {
  const buf = Buffer.alloc(1);
  let line = '';
  while (true) {
    const n = fs.readSync(fd, buf, 0, 1, null);
    if (n === 0) return line;
    const ch = buf.toString('utf8');
    if (ch === '\n') return line;
    if (ch === '\r') continue;
    line += ch;
  }
}

export async function simplePrompt(qs: ReadonlyArray<Record<string, unknown>>): Promise<Record<string, unknown>> {
  let inFd: number;
  let outFd: number;
  try {
    inFd = fs.openSync('/dev/tty', 'r');
    outFd = fs.openSync('/dev/tty', 'w');
  } catch {
    throw new Error('simplePrompt: cannot open /dev/tty');
  }
  const write = (s: string) => fs.writeSync(outFd, s);
  const out: Record<string, unknown> = {};
  try {
    for (const raw of qs) {
      const q = raw as Question;
      const label = q.message.replace(/:\s*$/, '');
      if (q.type === 'confirm') {
        const def = q.default !== false;
        write(`${label} ${def ? '[Y/n]' : '[y/N]'}: `);
        const answer = readLineSync(inFd).trim().toLowerCase();
        out[q.name] = answer === '' ? def : answer === 'y' || answer === 'yes';
      } else if (q.type === 'input') {
        const def = typeof q.default === 'string' ? q.default : '';
        write(def ? `${label} [${def}]: ` : `${label}: `);
        const answer = readLineSync(inFd).trim();
        out[q.name] = answer || def;
      } else if (q.type === 'list') {
        write(`${label}\n`);
        const choices = q.choices ?? [];
        choices.forEach((c, i) => write(`  ${i + 1}) ${c.name}\n`));
        while (true) {
          write(`Pick 1-${choices.length}: `);
          const answer = readLineSync(inFd).trim();
          const n = Number.parseInt(answer, 10);
          if (Number.isFinite(n) && n >= 1 && n <= choices.length) {
            out[q.name] = choices[n - 1].value;
            break;
          }
        }
      }
    }
  } finally {
    try {
      fs.closeSync(inFd);
    } catch {}
    try {
      fs.closeSync(outFd);
    } catch {}
  }
  return out;
}

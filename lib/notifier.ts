import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { NotificationCenter } from 'node-notifier';

function resolveLogoPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'assets', 'logo.png');
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const LOGO_PATH = resolveLogoPath();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const notifier: any = new NotificationCenter();

export interface NotifyOptions {
  subtitle: string;
  message: string;
  actions?: string[];
  closeLabel?: string;
  open?: string;
  sound?: boolean;
  wait?: boolean;
  timeout?: number;
}

export type NotifyCallback = (
  err: unknown,
  response: unknown,
  metadata: { activationValue?: string; activationType?: string },
) => void;

export function notify(opts: NotifyOptions, callback?: NotifyCallback): void {
  notifier.notify(
    {
      title: 'Clocktopus',
      subtitle: opts.subtitle,
      message: opts.message,
      sound: opts.sound ?? true,
      wait: opts.wait ?? true,
      actions: opts.actions,
      closeLabel: opts.closeLabel,
      open: opts.open,
      timeout: opts.timeout,
      contentImage: LOGO_PATH,
    },
    callback ??
      ((err: unknown) => {
        if (err) console.error('Notification error:', err);
      }),
  );
}

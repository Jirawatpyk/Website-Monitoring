// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PdfModel } from '../words';
import { pdfPrinter } from './render';

// The drafts cron prints every changed client in one browser (S20 code review); a failed launch or a
// crashed browser must cost that one client only (advisor, S20).
const model = {} as PdfModel;
const fakeBrowser = (id: number) => ({ id, close: vi.fn(async () => {}) });

describe('pdfPrinter', () => {
  it('launches nothing until a print, then one browser for every print', async () => {
    const launch = vi.fn(async () => fakeBrowser(1));
    const print = vi.fn(async () => Buffer.from('%PDF-'));
    const p = pdfPrinter({ launch, print });
    expect(launch).not.toHaveBeenCalled();
    await p.render(model);
    await p.render(model);
    await p.render(model);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(3);
    await p.close();
    expect((await launch.mock.results[0]!.value).close).toHaveBeenCalledTimes(1);
  });

  it('a failed launch fails that print only; the next one launches again', async () => {
    let n = 0;
    const launch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('no chromium');
      return fakeBrowser(n);
    });
    const p = pdfPrinter({ launch, print: async () => Buffer.from('%PDF-') });
    await expect(p.render(model)).rejects.toThrow('no chromium');
    await expect(p.render(model)).resolves.toBeInstanceOf(Buffer);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('a print that fails (a crashed browser) closes it; the next print gets a fresh one', async () => {
    const browsers: ReturnType<typeof fakeBrowser>[] = [];
    const launch = vi.fn(async () => {
      const b = fakeBrowser(browsers.length + 1);
      browsers.push(b);
      return b;
    });
    const print = vi.fn(async (b: ReturnType<typeof fakeBrowser>) => {
      if (b.id === 1) throw new Error('Target closed');
      return Buffer.from('%PDF-');
    });
    const p = pdfPrinter({ launch, print });
    await expect(p.render(model)).rejects.toThrow('Target closed');
    expect(browsers[0]!.close).toHaveBeenCalledTimes(1);
    await expect(p.render(model)).resolves.toBeInstanceOf(Buffer);
    expect(launch).toHaveBeenCalledTimes(2);
    await p.close();
    expect(browsers[1]!.close).toHaveBeenCalledTimes(1);
  });

  it('close with nothing launched does nothing', async () => {
    const launch = vi.fn();
    await pdfPrinter({ launch, print: vi.fn() }).close();
    expect(launch).not.toHaveBeenCalled();
  });
});

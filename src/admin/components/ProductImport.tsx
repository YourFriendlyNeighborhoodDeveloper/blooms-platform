import { useState } from 'react';
import { api } from '../../lib/api';
import { Btn, Card, useAction } from '../ui';

type Result = { ok: boolean; products: number; variants: number; stocked: number; categories_created: string[]; errors: Array<{ line: number; message: string }>; dry_run: boolean };

/** Loads many products at once from a spreadsheet saved as CSV. It checks the whole file before writing anything. */
export function ProductImport({ onImported }: { onImported: () => void }) {
  const { busy, run } = useAction();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    const res = await api<Result>('/api/admin/catalog/import', { body: { csv: file.text, dry_run: dryRun } });
    setResult(res);
    if (!dryRun && res.ok) onImported();
    return res;
  };

  return (
    <Card title="From a spreadsheet" className="mt-4">
      <p className="text-[0.85rem] text-charcoal/75">
        Add many products at once. Fill in the template in Excel, Numbers or Google Sheets, save it as CSV, and choose the file here. Each row is one size or variant, and rows with the same name become one product. Products arrive as drafts, so you can add photos and check them before they go on sale. Add photos on each product afterwards.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="inline-flex h-8 items-center rounded-lg border border-charcoal/25 px-3 text-[0.8rem]" href="/api/admin/catalog/import/template.csv">Download the template</a>
        <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-charcoal/25 px-3 text-[0.8rem] has-[:focus-visible]:outline-2">
          {file ? `Chosen: ${file.name}` : 'Choose a CSV file'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setResult(null);
              setFile(f ? { name: f.name, text: await f.text() } : null);
              e.target.value = '';
            }}
          />
        </label>
        <Btn small disabled={busy || !file} onClick={() => run(() => send(true))}>Check the file</Btn>
        <Btn small tone="primary" disabled={busy || !file || !result?.ok || !result.dry_run} onClick={() => run(() => send(false))}>Import</Btn>
      </div>
      {result && result.ok && (
        <p role="status" className="mt-3 rounded-lg bg-sage/10 p-3 text-[0.85rem]">
          {result.dry_run ? 'Ready to import: ' : 'Imported: '}
          {result.products} {result.products === 1 ? 'product' : 'products'} with {result.variants} {result.variants === 1 ? 'variant' : 'variants'}, {result.stocked} with stock counts
          {result.categories_created.length > 0 && `, and new categories: ${result.categories_created.join(', ')}`}.
        </p>
      )}
      {result && !result.ok && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-deep/30 bg-blush/40 p-3 text-[0.85rem]">
          <p className="font-medium">Nothing was imported. Please fix these and check again:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.errors.slice(0, 50).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
          </ul>
          {result.errors.length > 50 && <p className="mt-1">And {result.errors.length - 50} more.</p>}
        </div>
      )}
    </Card>
  );
}

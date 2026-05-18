const fs = require('fs');
const src_path = 'src/app/proveedores/[id]/page.tsx';
let src = fs.readFileSync(src_path, 'utf8');

const startMarker = '// ─────────────────────────────────────────────────────────────────────────────\n// ── CATÁLOGO COMPLETO DEL PROVEEDOR';
const endMarker = '\n\n// ── Draft de edición';
const si = src.indexOf(startMarker);
const ei = src.indexOf(endMarker);
console.log('start:', si, 'end:', ei);

const newSection = `// ─────────────────────────────────────────────────────────────────────────────
// ── CATÁLOGO COMPLETO DEL PROVEEDOR (Excel + PDF + Imagen via IA)
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  sheet: string;
  category: string;
  code: string;
  desc: string;
  priceUSD: number | null;
  priceARS: number | null;
  unit: string;
  pack: number;
  isNew: boolean;
  notes: string;
  inAcqua: boolean;
  acquaId?: string;
  acquaName?: string;
  acquaCost?: number;
  acquaPrice?: number;
  source: 'excel' | 'ai';
}

function parseCatalogSheets(sheets: { name: string; rows: unknown[][] }[]): CatalogItem[] {
  const items: CatalogItem[] = [];
  const byCode = new Map<string, { id: string; name: string; cost: number; price: number }>();
  const byName = new Map<string, { id: string; name: string; cost: number; price: number }>();
  (productsData as Array<{ id: string; supplierCode: string | null; name: string; cost: number; price: number }>).forEach(p => {
    if (p.supplierCode) byCode.set(p.supplierCode.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
    byName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
  });
  const norm    = (v: unknown) => String(v ?? '').trim();
  const toNum   = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(',','.')); return isFinite(n) && n > 0 ? n : 0; };
  const isNumId = (v: unknown) => { const n = Number(v); return isFinite(n) && n > 0; };
  let idx = 0;
  for (const { name: sheetName, rows } of sheets) {
    if (!rows || rows.length < 5) continue;
    let cat = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length < 3) continue;
      const col1 = row[1]; const col2 = norm(row[2]);
      if (isNumId(col1) && col2) {
        const code = String(col1).trim();
        const pUSD = toNum(row[6]);
        const match = byCode.get(code.toLowerCase()) ?? byName.get(col2.toLowerCase());
        items.push({ id: \`cat_\${idx++}\`, sheet: sheetName, category: cat, code, desc: col2,
          priceUSD: pUSD || null, priceARS: null,
          unit: norm(row[7]) || 'U', pack: toNum(row[8]) || 1, isNew: norm(row[5]).toLowerCase().includes('nuevo'),
          notes: '', source: 'excel',
          inAcqua: !!match, acquaId: match?.id, acquaName: match?.name, acquaCost: match?.cost, acquaPrice: match?.price });
      } else {
        const c1s = norm(col1).toLowerCase();
        if (!c1s || c1s === 'código' || c1s === ' ' || c1s.length > 50) continue;
        cat = norm(col1);
      }
    }
  }
  return items;
}

function mergeAIItems(aiItems: Array<{ code: string; desc: string; priceUSD: number | null; priceARS: number | null; unit: string; category: string; notes: string }>): CatalogItem[] {
  const byCode = new Map<string, { id: string; name: string; cost: number; price: number }>();
  const byName = new Map<string, { id: string; name: string; cost: number; price: number }>();
  (productsData as Array<{ id: string; supplierCode: string | null; name: string; cost: number; price: number }>).forEach(p => {
    if (p.supplierCode) byCode.set(p.supplierCode.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
    byName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
  });
  return aiItems.map((ai, i) => {
    const match = byCode.get(ai.code.trim().toLowerCase()) ?? byName.get(ai.desc.trim().toLowerCase());
    return { id: \`ai_\${i}\`, sheet: 'IA', category: ai.category, code: ai.code, desc: ai.desc,
      priceUSD: ai.priceUSD, priceARS: ai.priceARS,
      unit: ai.unit || 'U', pack: 1, isNew: false, notes: ai.notes, source: 'ai' as const,
      inAcqua: !!match, acquaId: match?.id, acquaName: match?.name, acquaCost: match?.cost, acquaPrice: match?.price };
  });
}

function downloadCSV(rows: string[][], filename: string) {
  const csv  = rows.map(r => r.map(c => \`"\${String(c ?? '').replace(/"/g,'""')}"\`).join(',')).join('\\n');
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const MIME_MAP: Record<string, 'excel' | 'image' | 'pdf'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel': 'excel',
  'application/pdf': 'pdf',
  'image/jpeg': 'image', 'image/jpg': 'image', 'image/png': 'image',
  'image/webp': 'image', 'image/gif': 'image', 'image/heic': 'image',
};

function guessType(f: File): 'excel' | 'image' | 'pdf' | '' {
  if (MIME_MAP[f.type]) return MIME_MAP[f.type];
  const n = f.name.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel';
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.match(/\\.(jpg|jpeg|png|gif|webp|heic)$/)) return 'image';
  return '';
}

function SupplierCatalogModal({ onClose, supplierName, geminiKey }: {
  onClose: () => void; supplierName: string; geminiKey?: string;
}) {
  type Phase = 'idle' | 'reading' | 'ai_processing' | 'review' | 'ready';

  const [phase,       setPhase]       = useState<Phase>('idle');
  const [items,       setItems]       = useState<CatalogItem[]>([]);
  const [aiSummary,   setAiSummary]   = useState('');
  const [currency,    setCurrency]    = useState<'USD' | 'ARS' | 'unknown'>('USD');
  const [search,      setSearch]      = useState('');
  const [sheetFilter, setSheetFilter] = useState<string>('todas');
  const [matchFilter, setMatchFilter] = useState<'todos' | 'acqua' | 'nuevo'>('todos');
  const [usdRate,     setUsdRate]     = useState<number>(1200);
  const [qtys,        setQtys]        = useState<Record<string, number>>({});
  const [tab,         setTab]         = useState<'catalogo' | 'pedido'>('catalogo');
  const [dragging,    setDragging]    = useState(false);
  const [fileName,    setFileName]    = useState('');
  const [fileType,    setFileType]    = useState<'excel' | 'image' | 'pdf' | ''>('');
  const [error,       setError]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const sheetNames = useMemo(() => ['todas', ...Array.from(new Set(items.map(i => i.sheet)))], [items]);

  const filtered = useMemo(() => items.filter(item => {
    if (sheetFilter !== 'todas' && item.sheet !== sheetFilter) return false;
    if (matchFilter === 'acqua' && !item.inAcqua) return false;
    if (matchFilter === 'nuevo' &&  item.inAcqua) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.code.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
    }
    return true;
  }), [items, sheetFilter, matchFilter, search]);

  const pedidoItems = useMemo(() => items.filter(i => (qtys[i.id] ?? 0) > 0).map(i => ({ ...i, qty: qtys[i.id] })), [items, qtys]);
  const pedidoTotalUSD = pedidoItems.reduce((s, i) => s + (i.priceUSD ?? 0) * i.qty, 0);
  const pedidoTotalARS = pedidoItems.reduce((s, i) => { const ars = i.priceARS ?? (i.priceUSD ? i.priceUSD * usdRate : 0); return s + ars * i.qty; }, 0);
  const stats = useMemo(() => ({ total: items.length, acqua: items.filter(i => i.inAcqua).length, nuevo: items.filter(i => !i.inAcqua).length }), [items]);

  const priceInARS = (item: CatalogItem) => item.priceARS ?? (item.priceUSD && usdRate > 0 ? item.priceUSD * usdRate : null);

  const handleFile = async (f: File) => {
    setError('');
    setFileName(f.name);
    const ftype = guessType(f);
    if (!ftype) { setError('Formato no soportado. Usá Excel (.xlsx), PDF o imagen (JPG/PNG/WEBP).'); return; }
    setFileType(ftype);

    if (ftype === 'excel') {
      setPhase('reading');
      try {
        const buf  = await f.arrayBuffer();
        const wb   = XLSX.read(buf, { type: 'array', cellDates: false });
        const sheets = wb.SheetNames.map(name => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', blankrows: false }),
        }));
        setItems(parseCatalogSheets(sheets));
        setCurrency('USD');
        setPhase('ready');
      } catch (e) { setError('Error leyendo el Excel: ' + String(e)); setPhase('idle'); }
    } else {
      if (!geminiKey) { setError('Para leer PDF e imágenes configurá tu clave Gemini en ML Lab → Parámetros globales → Clave IA.'); return; }
      setPhase('ai_processing');
      try {
        const buf  = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let b64 = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          b64 += String.fromCharCode(...bytes.slice(i, i + chunkSize));
        }
        b64 = btoa(b64);
        const mimeType = ftype === 'pdf' ? 'application/pdf' : (f.type || 'image/jpeg');
        const res = await fetch('/api/catalog-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': geminiKey },
          body: JSON.stringify({ mimeType, data: b64, fileName: f.name }),
        });
        const data = await res.json() as { ok: boolean; items?: Array<{ code: string; desc: string; priceUSD: number|null; priceARS: number|null; unit: string; category: string; notes: string }>; currency?: 'USD'|'ARS'|'unknown'; supplierGuess?: string; rawSummary?: string; error?: string };
        if (!data.ok || !data.items) throw new Error(data.error ?? 'La IA no pudo interpretar el archivo');
        setAiSummary(data.rawSummary ?? '');
        setCurrency(data.currency ?? 'unknown');
        if (data.currency === 'ARS') setUsdRate(0);
        setItems(mergeAIItems(data.items));
        setPhase('review');
      } catch (e) { setError(String(e)); setPhase('idle'); }
    }
  };

  const reset = () => { setPhase('idle'); setItems([]); setQtys({}); setFileName(''); setFileType(''); setError(''); setAiSummary(''); };
  const setQty = (id: string, qty: number) => setQtys(prev => qty > 0 ? { ...prev, [id]: qty } : (({ [id]: _, ...rest }) => rest)(prev));

  const exportCSV = () => downloadCSV([
    ['Categoría','Código','Descripción','USD','ARS','Unid','Pack','En Acqua','Nombre Acqua','Costo Acqua'],
    ...filtered.map(i => [i.category,i.code,i.desc, i.priceUSD?.toFixed(2)??'', priceInARS(i)?.toFixed(0)??'',i.unit,String(i.pack),i.inAcqua?'Sí':'No',i.acquaName??'',i.acquaCost?.toFixed(2)??'']),
  ], \`catalogo-\${supplierName.toLowerCase().replace(/\\s+/g,'-')}-\${new Date().toISOString().slice(0,10)}.csv\`);

  const exportPedido = () => downloadCSV([
    ['Código','Descripción','USD unit','ARS unit','Cantidad','Total USD','Total ARS'],
    ...pedidoItems.map(i => [i.code,i.desc, i.priceUSD?.toFixed(2)??'', priceInARS(i)?.toFixed(0)??'', String(i.qty), ((i.priceUSD??0)*i.qty).toFixed(2), ((priceInARS(i)??0)*i.qty).toFixed(0)]),
    ['','','','','TOTAL',pedidoTotalUSD.toFixed(2),pedidoTotalARS.toFixed(0)],
  ], \`pedido-\${supplierName.toLowerCase().replace(/\\s+/g,'-')}-\${new Date().toISOString().slice(0,10)}.csv\`);

  const ftypeIcon = { excel: '📊', pdf: '📄', image: '🖼️', '': '' }[fileType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full shadow-2xl flex flex-col" style={{ maxWidth: 1200, maxHeight: '96vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-600" />
              Lista de precios — {supplierName}
              {fileType && <span className="text-[11px] font-normal text-gray-400">{ftypeIcon} {fileName}</span>}
            </h3>
            {(phase === 'ready' || phase === 'review') && (
              <p className="text-[11px] text-gray-400 mt-0.5">{stats.total} productos · <span className="text-success font-semibold">{stats.acqua} ya en Acqua</span> · {stats.nuevo} nuevos</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(phase === 'ready' || phase === 'review') && (
              <>
                {(currency === 'USD' || currency === 'unknown') && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <span className="text-[10px] font-semibold text-amber-700">USD →</span>
                    <span className="text-[10px] text-amber-500">$</span>
                    <input type="number" value={usdRate} onChange={e => setUsdRate(Math.max(1, Number(e.target.value)))}
                      className="w-16 text-[12px] font-bold text-amber-800 bg-transparent outline-none" step="50" />
                    <span className="text-[9px] text-amber-400">ARS</span>
                  </div>
                )}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setTab('catalogo')}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors', tab === 'catalogo' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    Catálogo
                  </button>
                  <button onClick={() => setTab('pedido')}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5', tab === 'pedido' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    Pedido
                    {pedidoItems.length > 0 && <span className="inline-flex items-center justify-center w-4 h-4 bg-acqua text-white text-[9px] font-bold rounded-full">{pedidoItems.length}</span>}
                  </button>
                </div>
              </>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">

          {/* IDLE */}
          {phase === 'idle' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-5">
              {error && (
                <div className="w-full max-w-lg bg-danger/5 border border-danger/20 rounded-xl p-3 text-[12px] text-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => fileRef.current?.click()}
                className={cn('border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors w-full max-w-lg',
                  dragging ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/40')}
              >
                <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-[16px] font-semibold text-gray-600">Arrastrá la lista de precios</p>
                <p className="text-[13px] text-gray-400 mt-1">o hacé click para seleccionar</p>
                <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                  {[
                    { l: '📊 Excel .xlsx', c: 'bg-green-50 border-green-200 text-green-700' },
                    { l: '📄 PDF', c: 'bg-red-50 border-red-200 text-red-700' },
                    { l: '🖼️ Imagen JPG/PNG', c: 'bg-blue-50 border-blue-200 text-blue-700' },
                  ].map(f => <span key={f.l} className={cn('px-2.5 py-1 rounded-lg border text-[11px] font-medium', f.c)}>{f.l}</span>)}
                </div>
                <p className="text-[11px] text-gray-300 mt-3">PDF e imágenes → IA de Gemini las interpreta automáticamente</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-lg w-full text-[11px] text-center">
                {[
                  { icon: '📊', t: 'Excel', s: 'Detección automática de todas las hojas' },
                  { icon: '📄', t: 'PDF', s: 'IA interpreta el contenido completo' },
                  { icon: '🖼️', t: 'Imagen', s: 'Foto o lista escaneada' },
                ].map(c => (
                  <div key={c.t} className="bg-gray-50 rounded-xl p-3">
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <p className="font-semibold text-gray-700">{c.t}</p>
                    <p className="text-gray-400">{c.s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LOADING */}
          {(phase === 'reading' || phase === 'ai_processing') && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <RefreshCw className="w-10 h-10 text-purple-500 animate-spin" />
              <div className="text-center">
                <p className="text-[14px] font-semibold text-gray-700">
                  {phase === 'reading' ? 'Leyendo el Excel…' : 'La IA está interpretando el archivo…'}
                </p>
                <p className="text-[12px] text-gray-400 mt-1">
                  {phase === 'ai_processing' ? 'Puede tardar hasta 30 segundos' : 'Detectando productos en todas las hojas'}
                </p>
              </div>
              {phase === 'ai_processing' && (
                <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border border-purple-200 rounded-xl text-[12px] text-purple-700">
                  <Sparkles className="w-4 h-4 animate-pulse" /> Gemini 2.0 Flash leyendo {ftypeIcon}
                </div>
              )}
            </div>
          )}

          {/* REVIEW banner (IA result) */}
          {phase === 'review' && (
            <div className="px-5 py-3 border-b border-gray-100 bg-purple-50/80 shrink-0">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-purple-800">IA interpretó el archivo — revisá los datos antes de usar</p>
                  {aiSummary && <p className="text-[12px] text-purple-700 mt-0.5">{aiSummary}</p>}
                  <p className="text-[11px] text-purple-500 mt-0.5">Moneda: <strong>{currency === 'USD' ? '🇺🇸 USD' : currency === 'ARS' ? '🇦🇷 ARS' : 'No detectada'}</strong></p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setPhase('ready')}
                    className="px-3 py-1.5 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                    Confirmar ✓
                  </button>
                  <button onClick={reset}
                    className="px-3 py-1.5 border border-purple-200 text-purple-600 text-[12px] font-medium rounded-lg hover:bg-purple-100 transition-colors">
                    Subir otro
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TABLE */}
          {(phase === 'ready' || phase === 'review') && tab === 'catalogo' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 shrink-0 flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, descripción, categoría…"
                    className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 bg-white" />
                </div>
                {sheetNames.length > 2 && (
                  <select value={sheetFilter} onChange={e => setSheetFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none bg-white">
                    {sheetNames.map(s => <option key={s} value={s}>{s === 'todas' ? 'Todas las hojas' : s.replace(/^LP\s+/i,'')}</option>)}
                  </select>
                )}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {([{ k: 'todos', l: 'Todos' }, { k: 'acqua', l: '✓ En Acqua' }, { k: 'nuevo', l: 'Nuevos' }] as const).map(f => (
                    <button key={f.k} onClick={() => setMatchFilter(f.k)}
                      className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors', matchFilter === f.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                      {f.l}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-gray-400">{filtered.length} resultados</span>
                <button onClick={exportCSV}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                  <FileDown className="w-3.5 h-3.5" /> Exportar CSV
                </button>
                <button onClick={reset} className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 text-gray-500 text-[11px] rounded-lg hover:bg-gray-50">
                  <RefreshCw className="w-3 h-3" /> Nueva lista
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                    <tr>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-28">Categoría</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Código</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase">Descripción</th>
                      <th className="text-right px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Precio</th>
                      <th className="text-right px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-28">ARS</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-14">Unid</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-20">Estado</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-44">En Acqua</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Pedido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 700).map(item => {
                      const arsPrice = priceInARS(item);
                      const priceDiff = item.acquaCost && arsPrice ? arsPrice - item.acquaCost : null;
                      return (
                        <tr key={item.id} className={cn('border-b border-gray-50 hover:bg-gray-50/70 transition-colors', item.inAcqua && 'bg-green-50/20')}>
                          <td className="px-3 py-1.5"><span className="text-[9px] text-gray-400 truncate block max-w-[110px]" title={item.category}>{item.category}</span></td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[10px] text-gray-700 font-semibold">{item.code}</span>
                            {item.isNew && <span className="ml-1 text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-bold">NEW</span>}
                            {item.source === 'ai' && <span className="ml-1 text-[8px] bg-purple-100 text-purple-600 px-1 py-0.5 rounded">IA</span>}
                          </td>
                          <td className="px-3 py-1.5 max-w-[250px]">
                            <span className="text-gray-800 leading-tight line-clamp-2 text-[11px]">{item.desc}</span>
                            {item.notes && <span className="text-[9px] text-amber-600 block">{item.notes}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {item.priceUSD != null ? <span className="font-semibold text-gray-700">US$ {item.priceUSD.toFixed(2)}</span>
                            : item.priceARS != null ? <span className="font-semibold text-gray-700">{formatARS(item.priceARS)}</span>
                            : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {arsPrice != null && arsPrice > 0 ? <span className="font-bold text-acqua">{formatARS(arsPrice)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-center text-gray-500 text-[10px]">{item.unit}</td>
                          <td className="px-3 py-1.5 text-center">
                            {item.inAcqua
                              ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-success/10 text-success text-[9px] font-bold rounded-full border border-success/20"><span className="w-1.5 h-1.5 rounded-full bg-success" /> Acqua</span>
                              : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-bold rounded-full border border-purple-200"><span className="w-1.5 h-1.5 rounded-full bg-purple-400" /> Nuevo</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            {item.acquaName ? (
                              <div>
                                <p className="text-[10px] text-gray-600 leading-tight truncate max-w-[170px]" title={item.acquaName}>{item.acquaName}</p>
                                {item.acquaCost && arsPrice ? (
                                  <p className="text-[9px]">
                                    <span className="text-gray-400">Costo: {formatARS(item.acquaCost)}</span>
                                    {priceDiff !== null && (
                                      <span className={cn('ml-1 font-bold', priceDiff > 0 ? 'text-danger' : 'text-success')}>
                                        {priceDiff > 0 ? '↑' : '↓'} {formatARS(Math.abs(priceDiff))}
                                      </span>
                                    )}
                                  </p>
                                ) : null}
                              </div>
                            ) : <span className="text-gray-300 text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setQty(item.id, Math.max(0, (qtys[item.id] ?? 0) - 1))} className="w-5 h-5 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[10px] font-bold">−</button>
                              <input type="number" min="0" value={qtys[item.id] ?? 0}
                                onChange={e => setQty(item.id, Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-8 text-center text-[11px] font-semibold border border-gray-200 rounded outline-none focus:border-acqua" />
                              <button onClick={() => setQty(item.id, (qtys[item.id] ?? 0) + 1)} className="w-5 h-5 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[10px] font-bold">+</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length > 700 && <tr><td colSpan={9} className="px-3 py-3 text-center text-[11px] text-gray-400">Mostrando 700 de {filtered.length}. Usá filtros o exportá el CSV.</td></tr>}
                    {filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-12 text-center text-[12px] text-gray-400">Sin resultados</td></tr>}
                  </tbody>
                </table>
              </div>

              {pedidoItems.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200 bg-acqua/5 shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-[12px] text-gray-600">
                    <span><span className="font-bold text-gray-900">{pedidoItems.length}</span> en pedido</span>
                    {pedidoTotalUSD > 0 && <span>USD: <span className="font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</span></span>}
                    <span>ARS: <span className="font-bold text-acqua">{formatARS(pedidoTotalARS)}</span></span>
                  </div>
                  <button onClick={() => setTab('pedido')} className="flex items-center gap-1.5 px-3 py-1.5 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                    Ver pedido →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PEDIDO tab */}
          {(phase === 'ready' || phase === 'review') && tab === 'pedido' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {pedidoItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
                  <ShoppingCart className="w-10 h-10 text-gray-200" />
                  <p className="text-[13px] font-medium">No hay productos en el pedido</p>
                  <button onClick={() => setTab('catalogo')} className="mt-2 px-4 py-2 bg-gray-100 text-gray-600 text-[12px] font-semibold rounded-lg hover:bg-gray-200 transition-colors">← Ir al catálogo</button>
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-center">
                        <p className="text-[10px] text-gray-400 uppercase">Total USD</p>
                        <p className="text-lg font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</p>
                      </div>
                      <div className="bg-acqua/5 border border-acqua/20 rounded-xl px-4 py-2 text-center">
                        <p className="text-[10px] text-gray-400 uppercase">Total ARS</p>
                        <p className="text-lg font-bold text-acqua">{formatARS(pedidoTotalARS)}</p>
                      </div>
                    </div>
                    <button onClick={exportPedido} className="flex items-center gap-1.5 px-4 py-2 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                      <FileDown className="w-4 h-4" /> Exportar pedido CSV
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">Código</th>
                          <th className="text-left px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase">Descripción</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">USD unit</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-28">ARS unit</th>
                          <th className="text-center px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">Cant.</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-28">Total USD</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-32">Total ARS</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidoItems.map(item => {
                          const ars = priceInARS(item);
                          return (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-gray-700 font-semibold">{item.code}</td>
                              <td className="px-4 py-2.5"><p className="text-gray-800 font-medium">{item.desc}</p><p className="text-[9px] text-gray-400">{item.category}</p></td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{item.priceUSD != null ? \`US$ \${item.priceUSD.toFixed(2)}\` : '—'}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-acqua">{ars ? formatARS(ars) : '—'}</td>
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => setQty(item.id, item.qty - 1)} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[11px] font-bold">−</button>
                                  <span className="w-8 text-center font-bold text-gray-900">{item.qty}</span>
                                  <button onClick={() => setQty(item.id, item.qty + 1)} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[11px] font-bold">+</button>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{item.priceUSD != null ? \`US$ \${(item.priceUSD * item.qty).toFixed(2)}\` : '—'}</td>
                              <td className="px-4 py-2.5 text-right font-bold text-acqua">{ars ? formatARS(ars * item.qty) : '—'}</td>
                              <td className="px-4 py-2.5 text-center"><button onClick={() => setQty(item.id, 0)} className="text-gray-300 hover:text-danger transition-colors"><X className="w-3.5 h-3.5" /></button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200 bg-gray-50">
                          <td colSpan={5} className="px-4 py-3 text-right text-[12px] font-bold text-gray-700">TOTAL:</td>
                          <td className="px-4 py-3 text-right text-[13px] font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-[13px] font-bold text-acqua">{formatARS(pedidoTotalARS)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}`;

src = src.slice(0, si) + newSection + src.slice(ei);
fs.writeFileSync(src_path, src, 'utf8');
console.log('OK — written', src.length, 'bytes');

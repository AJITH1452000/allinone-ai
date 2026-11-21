// Downloads the official docs ONCE into the "docs" knowledge base, so Learn uses exact, current APIs for code questions.
//   npm run load-docs        (run again any time to refresh; ~2 min, ~3 MB)
// Sources (public docs, raw Markdown from their GitHub repos): React reference (react.dev), MUI v5 component docs + API props
// + sx/theming, Vite guide/config, Recharts API. The server searches it only for MEDIUM questions (bugs, components, code).
import * as kb from '../kb.js';

const RAW = 'https://raw.githubusercontent.com';
const REACT = ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext', 'useReducer', 'useLayoutEffect', 'useId',
  'useTransition', 'useDeferredValue', 'memo', 'createContext', 'forwardRef', 'lazy', 'Suspense', 'Fragment', 'StrictMode'];
const MUI = [ // [component docs folder, API page]
  ['buttons/buttons', 'button'], ['text-fields/text-fields', 'text-field'], ['grid/grid', 'grid'], ['stack/stack', 'stack'],
  ['box/box', 'box'], ['app-bar/app-bar', 'app-bar'], ['drawers/drawers', 'drawer'], ['dialogs/dialogs', 'dialog'],
  ['table/table', 'table'], ['cards/cards', 'card'], ['typography/typography', 'typography'], ['tabs/tabs', 'tabs'],
  ['selects/selects', 'select'], ['snackbars/snackbars', 'snackbar'], ['autocomplete/autocomplete', 'autocomplete'],
];
const VITE = ['guide/index', 'guide/features', 'guide/env-and-mode', 'guide/static-deploy', 'config/index', 'config/shared-options', 'config/server-options', 'config/build-options'];
const RECHARTS = ['LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'AreaChart', 'Area', 'XAxis', 'YAxis', 'Tooltip', 'Legend', 'ResponsiveContainer', 'CartesianGrid', 'Cell', 'RadarChart', 'ComposedChart'];

const sources = [
  ...REACT.map((n) => [`React ${n}`, `${RAW}/reactjs/react.dev/main/src/content/reference/react/${n}.md`]),
  ['React createRoot', `${RAW}/reactjs/react.dev/main/src/content/reference/react-dom/client/createRoot.md`],
  ...MUI.flatMap(([doc, api]) => [
    [`MUI ${api} (guide)`, `${RAW}/mui/material-ui/v5.x/docs/data/material/components/${doc}.md`],
    [`MUI ${api} (API props)`, `${RAW}/mui/material-ui/v5.x/docs/pages/material-ui/api/${api}.json`],
  ]),
  ['MUI sx prop', `${RAW}/mui/material-ui/v5.x/docs/data/system/getting-started/the-sx-prop/the-sx-prop.md`],
  ['MUI theming', `${RAW}/mui/material-ui/v5.x/docs/data/material/customization/theming/theming.md`],
  ...VITE.map((n) => [`Vite ${n}`, `${RAW}/vitejs/vite/main/docs/${n}.md`]),
  ...RECHARTS.map((n) => [`Recharts ${n}`, `${RAW}/recharts/recharts.org/master/src/docs/api/${n}.ts`]),
];

// Markdown/MDX → plain readable text (keeps code examples)
const cleanMd = (t) => t
  .replace(/^---[\s\S]*?---\n/, '')                       // front matter
  .replace(/\{\{"(component|demo)":[^}]*\}\}/g, '')        // MUI demo embeds
  .replace(/<\/?(Intro|Sandpack|DeepDive|Pitfall|Note|Recipes|Solution|Challenges|YouWillLearn|InlineToc|Recap|Hint|ConsoleBlock|Diagram|DiagramGroup|CodeStep|TerminalBlock|Illustration|IllustrationBlock|ExpandableExample|Wip|Canary|Deprecated|NextMajor|RSC)[^>]*>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const apiJson = (name, j) => {
  const props = Object.entries(j.props || {}).map(([p, v]) => {
    const type = v.type?.name === 'union' ? v.type.description : v.type?.name;
    return `- ${p}${type ? `: ${type}` : ''}${v.default ? ` (default ${v.default})` : ''}${v.deprecated ? ' — deprecated' : ''}`;
  });
  return `${name}\nImport: ${(j.imports || []).join(' | ')}\nProps:\n${props.join('\n')}\n${j.inheritance ? `Other props go to ${j.inheritance.component}.` : ''}`;
};
const recharts = (t) => t.replace(/'zh-CN':\s*(['"`])[\s\S]*?\1,?/g, '').replace(/^\s*import .*$/gm, '').trim();

const old = kb.listDocs('docs');
for (const d of old) kb.removeDoc('docs', d.id);
let ok = 0, failed = [];
for (const [name, url] of sources) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.text();
    const text = url.endsWith('.json') ? apiJson(name, JSON.parse(raw)) : url.endsWith('.ts') ? recharts(raw) : cleanMd(raw);
    await kb.addDoc('docs', name, `${name}\nSource: ${url.replace(RAW, 'github')}\n\n${text}`);
    ok++;
    process.stdout.write(`✔ ${name}\n`);
  } catch (e) { failed.push(`${name} (${e.message})`); process.stdout.write(`✘ ${name}: ${e.message}\n`); }
}
console.log(`\nDocs knowledge base: ${ok}/${sources.length} pages saved${old.length ? ` (replaced ${old.length} old pages)` : ''}.`);
if (failed.length) console.log(`Skipped: ${failed.join(', ')}`);
console.log('Learn now uses these exact APIs for code questions (bugs, components, errors).');

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import Parser from 'web-tree-sitter';

export type AstSymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'impl'
  | 'module'
  | 'const';

export interface AstSymbolSpan {
  name: string;
  kind: AstSymbolKind;
  startLine: number; // 1-based inclusive
  endLine: number; // 1-based inclusive
  exported: boolean;
  signature?: string;
  containerName?: string;
}

export interface CuratedSymbolMember {
  name: string;
  startLine: number;
  endLine: number;
  signature?: string;
  changed?: boolean;
  guardCount?: number;
}

export interface CuratedSymbolItem {
  name: string;
  kind: AstSymbolKind;
  startLine: number;
  endLine: number;
  exported: boolean;
  signature?: string;
  containerName?: string;
  changed: boolean;
  anchored: boolean;
  guards: AstGuardClause[];
  members: CuratedSymbolMember[];
}

export interface CuratedFileSymbols {
  language: string;
  totalCount: number;
  hiddenCount: number;
  symbols: CuratedSymbolItem[];
}

export interface AstImportRef {
  specifier: string;
  line: number; // 1-based
  kind: 'es-import' | 'cjs-require' | 'rust-use' | 'rust-mod' | 'py-import' | 'go-import';
}

export interface AstGuardClause {
  line: number; // 1-based
  endLine: number;
  condition: string;
  outcomeKind: 'return' | 'throw' | 'break' | 'continue';
  enclosingSymbol?: string;
}

export interface FileAstFacts {
  language: string;
  symbols: AstSymbolSpan[];
  imports: AstImportRef[];
  guardClauses: AstGuardClause[];
}

export interface FileAstSummary {
  path: string;
  language: string;
  symbols: AstSymbolSpan[];
  imports: string[];
  guardClauses: AstGuardClause[];
}

type SupportedLangId =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'rust'
  | 'python'
  | 'go'
  | 'java'
  | 'c';

const EXT_TO_LANG: Record<string, SupportedLangId> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.rs': 'rust',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
};

let initPromise: Promise<boolean> | undefined;
const loadedLanguages = new Map<SupportedLangId, Parser.Language>();
const astFactsCache = new Map<string, FileAstFacts>();
const MAX_AST_CACHE = 400;

function resolveCoreWasmFile(fileName: string): string | undefined {
  const candidates = [
    path.join(__dirname, 'grammars', fileName),
    path.resolve(__dirname, '..', 'dist', 'grammars', fileName),
    path.resolve(process.cwd(), 'dist', 'grammars', fileName),
    path.resolve(__dirname, '..', 'node_modules', 'web-tree-sitter', fileName),
    path.resolve(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out', fileName),
    path.resolve(process.cwd(), 'node_modules', 'web-tree-sitter', fileName),
    path.resolve(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out', fileName),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

async function ensureParserReady(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const runtimeWasm = resolveCoreWasmFile('tree-sitter.wasm');
        if (runtimeWasm) {
          await Parser.init({
            locateFile() {
              return runtimeWasm;
            },
          });
        } else {
          await Parser.init();
        }
        return true;
      } catch {
        return false;
      }
    })();
  }
  return initPromise;
}

async function getGrammarLanguage(langId: SupportedLangId): Promise<Parser.Language | undefined> {
  if (loadedLanguages.has(langId)) {
    return loadedLanguages.get(langId);
  }
  const ok = await ensureParserReady();
  if (!ok) return undefined;

  const wasmFile = `tree-sitter-${langId}.wasm`;
  const fullPath = resolveCoreWasmFile(wasmFile);
  if (!fullPath) return undefined;

  try {
    const lang = await Parser.Language.load(fullPath);
    loadedLanguages.set(langId, lang);
    return lang;
  } catch {
    return undefined;
  }
}

export function detectAstLanguage(filePath: string): SupportedLangId | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext];
}

function unquoteStringNode(raw: string): string {
  return raw.replace(/^['"`]|['"`]$/g, '').trim();
}

function compactOneLine(raw: string, maxLen = 96): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

function detectEarlyExitOutcome(
  consequenceNode: Parser.SyntaxNode | null
): AstGuardClause['outcomeKind'] | undefined {
  if (!consequenceNode) return undefined;
  // Guard clauses are concise early exits (<= 6 lines)
  if (consequenceNode.endPosition.row - consequenceNode.startPosition.row > 6) {
    return undefined;
  }

  // Only inspect shallow statements inside the consequence block (avoid nested loops/closures)
  const queue: Array<{ node: Parser.SyntaxNode; depth: number }> = [
    { node: consequenceNode, depth: 0 },
  ];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const t = node.type;
    if (t === 'return_statement' || t === 'return_expression') return 'return';
    if (t === 'throw_statement' || t === 'raise_statement') return 'throw';
    if (t === 'break_statement' || t === 'break_expression') return 'break';
    if (t === 'continue_statement' || t === 'continue_expression') return 'continue';
    // Rust panic! / bail! macro invocations
    if (t === 'macro_invocation') {
      const txt = node.text;
      if (/^(bail|panic|unreachable)\s*!/.test(txt)) return 'throw';
    }
    if (depth < 3) {
      for (const child of node.namedChildren) {
        if (
          child.type === 'if_statement' ||
          child.type === 'if_expression' ||
          child.type === 'arrow_function' ||
          child.type === 'function_declaration' ||
          child.type === 'closure_expression'
        ) {
          continue;
        }
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return undefined;
}

function formatCallableSignature(paramsRaw?: string, retRaw?: string): string {
  const params = paramsRaw ? compactOneLine(paramsRaw, 46) : '()';
  const cleanRet = retRaw ? compactOneLine(retRaw.replace(/^(:|->)\s*/, ''), 34) : '';
  return compactOneLine(cleanRet ? `${params} → ${cleanRet}` : params, 74);
}

function formatBracePreview(names: string[], maxShown = 3): string | undefined {
  if (names.length === 0) return undefined;
  const shown = names.slice(0, maxShown).join(', ');
  const extra = names.length > maxShown ? `, +${names.length - maxShown}` : '';
  return `{ ${shown}${extra} }`;
}

function extractBodyFieldNames(bodyNode: Parser.SyntaxNode | null): string[] {
  if (!bodyNode) return [];
  const names: string[] = [];
  for (const ch of bodyNode.namedChildren) {
    const nm = ch.childForFieldName('name')?.text;
    if (nm) names.push(nm);
    else if (ch.type === 'enum_assignment') {
      const first = ch.namedChild(0)?.text;
      if (first) names.push(first);
    }
  }
  return names;
}

function walkAndExtract(
  root: Parser.SyntaxNode,
  langId: SupportedLangId
): Omit<FileAstFacts, 'language'> {
  const symbols: AstSymbolSpan[] = [];
  const imports: AstImportRef[] = [];
  const guardClauses: AstGuardClause[] = [];

  const visit = (
    node: Parser.SyntaxNode,
    enclosingSym?: string,
    parentExported = false,
    enclosingContainer?: string
  ) => {
    const t = node.type;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // 1. Imports / Module dependencies
    if (langId === 'typescript' || langId === 'tsx' || langId === 'javascript') {
      if (t === 'import_statement' || t === 'export_statement') {
        const src = node.childForFieldName('source');
        if (src) {
          const spec = unquoteStringNode(src.text);
          if (spec) imports.push({ specifier: spec, line: startLine, kind: 'es-import' });
        }
      } else if (t === 'call_expression') {
        const fnNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        if (
          fnNode &&
          (fnNode.text === 'require' || fnNode.type === 'import') &&
          argsNode &&
          argsNode.namedChildCount >= 1
        ) {
          const arg0 = argsNode.namedChild(0);
          if (arg0 && (arg0.type === 'string' || arg0.type === 'template_string')) {
            const spec = unquoteStringNode(arg0.text);
            if (spec && !spec.includes('${')) {
              imports.push({ specifier: spec, line: startLine, kind: 'cjs-require' });
            }
          }
        }
      }
    } else if (langId === 'rust') {
      if (t === 'use_declaration') {
        const arg = node.childForFieldName('argument');
        if (arg) {
          imports.push({
            specifier: compactOneLine(arg.text, 140),
            line: startLine,
            kind: 'rust-use',
          });
        }
      } else if (t === 'mod_item' && !node.childForFieldName('body')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          imports.push({ specifier: nameNode.text, line: startLine, kind: 'rust-mod' });
        }
      }
    } else if (langId === 'python') {
      if (t === 'import_from_statement') {
        const modName = node.childForFieldName('module_name');
        if (modName) {
          imports.push({ specifier: modName.text, line: startLine, kind: 'py-import' });
        }
      } else if (t === 'import_statement') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          imports.push({ specifier: nameNode.text, line: startLine, kind: 'py-import' });
        }
      }
    } else if (langId === 'go') {
      if (t === 'import_spec') {
        const pathNode = node.childForFieldName('path');
        if (pathNode) {
          imports.push({
            specifier: unquoteStringNode(pathNode.text),
            line: startLine,
            kind: 'go-import',
          });
        }
      }
    }

    // 2. Symbol Declarations
    let currentSym = enclosingSym;
    let nextContainer = enclosingContainer;
    const isExportWrapper = t === 'export_statement';
    const hasRustPub =
      langId === 'rust' &&
      node.children.some((c) => c.type === 'visibility_modifier' && c.text.startsWith('pub'));

    const recordSym = (
      name: string | undefined,
      kind: AstSymbolKind,
      exported: boolean,
      spanStart = startLine,
      spanEnd = endLine,
      signature?: string,
      containerName?: string
    ) => {
      if (!name) return;
      symbols.push({
        name,
        kind,
        startLine: spanStart,
        endLine: spanEnd,
        exported,
        ...(signature ? { signature } : {}),
        ...(containerName ? { containerName } : {}),
      });
      currentSym = name;
    };

    if (langId === 'typescript' || langId === 'tsx' || langId === 'javascript') {
      const exp = parentExported || node.parent?.type === 'export_statement';
      const spanStart = node.parent?.type === 'export_statement' ? node.parent.startPosition.row + 1 : startLine;
      const spanEnd = node.parent?.type === 'export_statement' ? node.parent.endPosition.row + 1 : endLine;

      if (t === 'function_declaration' || t === 'generator_function_declaration') {
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('return_type')?.text
        );
        recordSym(node.childForFieldName('name')?.text, 'function', exp, spanStart, spanEnd, sig);
      } else if (t === 'class_declaration' || t === 'abstract_class_declaration') {
        const clsName = node.childForFieldName('name')?.text;
        const heritage = node.namedChildren.find((c) => c.type === 'class_heritage')?.text;
        recordSym(
          clsName,
          'class',
          exp,
          spanStart,
          spanEnd,
          heritage ? compactOneLine(heritage, 60) : undefined
        );
        if (clsName) nextContainer = clsName;
      } else if (t === 'interface_declaration') {
        const ifName = node.childForFieldName('name')?.text;
        const fields = extractBodyFieldNames(node.childForFieldName('body'));
        recordSym(ifName, 'interface', exp, spanStart, spanEnd, formatBracePreview(fields));
        if (ifName) nextContainer = ifName;
      } else if (t === 'type_alias_declaration') {
        const val = node.childForFieldName('value');
        const sig =
          val?.type === 'object_type'
            ? formatBracePreview(extractBodyFieldNames(val))
            : val
              ? compactOneLine(val.text, 56)
              : undefined;
        recordSym(node.childForFieldName('name')?.text, 'type', exp, spanStart, spanEnd, sig);
      } else if (t === 'enum_declaration') {
        const variants = extractBodyFieldNames(node.childForFieldName('body'));
        recordSym(
          node.childForFieldName('name')?.text,
          'enum',
          exp,
          spanStart,
          spanEnd,
          formatBracePreview(variants)
        );
      } else if (t === 'method_definition') {
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('return_type')?.text
        );
        recordSym(
          node.childForFieldName('name')?.text,
          'method',
          true,
          startLine,
          endLine,
          sig,
          enclosingContainer
        );
      } else if (
        (t === 'lexical_declaration' || t === 'variable_declaration') &&
        (node.parent?.type === 'program' || node.parent?.type === 'export_statement')
      ) {
        for (const decl of node.namedChildren) {
          if (decl.type === 'variable_declarator') {
            const idNode = decl.childForFieldName('name');
            const valNode = decl.childForFieldName('value');
            if (idNode && idNode.type === 'identifier') {
              const isFnVal =
                valNode?.type === 'arrow_function' || valNode?.type === 'function_expression';
              if (exp || isFnVal) {
                const sig = isFnVal
                  ? formatCallableSignature(
                      valNode?.childForFieldName('parameters')?.text ??
                        valNode?.childForFieldName('parameter')?.text,
                      valNode?.childForFieldName('return_type')?.text
                    )
                  : undefined;
                recordSym(
                  idNode.text,
                  isFnVal ? 'function' : 'const',
                  exp,
                  spanStart,
                  spanEnd,
                  sig
                );
              }
            }
          }
        }
      }
    } else if (langId === 'rust') {
      if (t === 'function_item') {
        const isImplMethod = node.parent?.type === 'declaration_list';
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('return_type')?.text
        );
        recordSym(
          node.childForFieldName('name')?.text,
          isImplMethod ? 'method' : 'function',
          hasRustPub,
          startLine,
          endLine,
          sig,
          isImplMethod ? enclosingContainer : undefined
        );
      } else if (t === 'struct_item') {
        const stName = node.childForFieldName('name')?.text;
        const fields = extractBodyFieldNames(node.childForFieldName('body'));
        recordSym(stName, 'struct', hasRustPub, startLine, endLine, formatBracePreview(fields));
      } else if (t === 'enum_item') {
        const enName = node.childForFieldName('name')?.text;
        const variants = extractBodyFieldNames(node.childForFieldName('body'));
        recordSym(enName, 'enum', hasRustPub, startLine, endLine, formatBracePreview(variants));
      } else if (t === 'trait_item') {
        const trName = node.childForFieldName('name')?.text;
        recordSym(trName, 'trait', hasRustPub);
        if (trName) nextContainer = trName;
      } else if (t === 'type_item') {
        const val = node.childForFieldName('type');
        recordSym(
          node.childForFieldName('name')?.text,
          'type',
          hasRustPub,
          startLine,
          endLine,
          val ? compactOneLine(val.text, 54) : undefined
        );
      } else if (t === 'const_item' || t === 'static_item') {
        recordSym(node.childForFieldName('name')?.text, 'const', hasRustPub);
      } else if (t === 'impl_item') {
        const typeNode = node.childForFieldName('type');
        const traitNode = node.childForFieldName('trait');
        if (typeNode) {
          const baseType = typeNode.text
            .split('<')[0]
            .replace(/^[&\s]+/, '')
            .split('::')
            .pop()
            ?.trim();
          const containerTarget = baseType || compactOneLine(typeNode.text, 48);
          const traitSig = traitNode ? `impl ${compactOneLine(traitNode.text, 36)}` : undefined;
          recordSym(containerTarget, 'impl', true, startLine, endLine, traitSig);
          nextContainer = containerTarget;
        }
      }
    } else if (langId === 'python') {
      if (t === 'function_definition') {
        const nm = node.childForFieldName('name')?.text;
        const isMethod = node.parent?.parent?.type === 'class_definition';
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('return_type')?.text
        );
        recordSym(
          nm,
          isMethod ? 'method' : 'function',
          Boolean(nm && !nm.startsWith('_')),
          startLine,
          endLine,
          sig,
          isMethod ? enclosingContainer : undefined
        );
      } else if (t === 'class_definition') {
        const nm = node.childForFieldName('name')?.text;
        const sup = node.childForFieldName('superclasses')?.text;
        recordSym(
          nm,
          'class',
          Boolean(nm && !nm.startsWith('_')),
          startLine,
          endLine,
          sup ? compactOneLine(sup, 48) : undefined
        );
        if (nm) nextContainer = nm;
      }
    } else if (langId === 'go') {
      if (t === 'function_declaration') {
        const nm = node.childForFieldName('name')?.text;
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('result')?.text
        );
        recordSym(nm, 'function', Boolean(nm && /^[A-Z]/.test(nm)), startLine, endLine, sig);
      } else if (t === 'method_declaration') {
        const nm = node.childForFieldName('name')?.text;
        const recvRaw = node.childForFieldName('receiver')?.text ?? '';
        const recvMatch = /\*?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?$/.exec(recvRaw);
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('result')?.text
        );
        recordSym(
          nm,
          'method',
          Boolean(nm && /^[A-Z]/.test(nm)),
          startLine,
          endLine,
          sig,
          recvMatch?.[1]
        );
      } else if (t === 'type_spec') {
        const nm = node.childForFieldName('name')?.text;
        const typeNode = node.childForFieldName('type');
        const kind: AstSymbolKind =
          typeNode?.type === 'struct_type'
            ? 'struct'
            : typeNode?.type === 'interface_type'
              ? 'interface'
              : 'type';
        recordSym(nm, kind, Boolean(nm && /^[A-Z]/.test(nm)));
      }
    } else if (langId === 'java' || langId === 'c') {
      if (t === 'class_declaration') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'class', true);
        if (nm) nextContainer = nm;
      } else if (t === 'interface_declaration') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'interface', true);
        if (nm) nextContainer = nm;
      } else if (t === 'method_declaration') {
        const sig = formatCallableSignature(
          node.childForFieldName('parameters')?.text,
          node.childForFieldName('type')?.text
        );
        recordSym(
          node.childForFieldName('name')?.text,
          'method',
          true,
          startLine,
          endLine,
          sig,
          enclosingContainer
        );
      } else if (t === 'function_definition') {
        const decl = node.childForFieldName('declarator');
        const id = decl?.childForFieldName('declarator') ?? decl;
        if (id?.text) {
          const fnName = id.text.split('(')[0].replace(/^\*+/, '').trim();
          const params = decl?.childForFieldName('parameters')?.text;
          if (fnName) {
            recordSym(
              fnName,
              'function',
              true,
              startLine,
              endLine,
              params ? formatCallableSignature(params) : undefined
            );
          }
        }
      }
    }

    // 3. Guard Clauses (Early-return / Early-throw `if` without `else`, or Rust `let ... else`)
    if (
      (t === 'if_statement' || t === 'if_expression') &&
      currentSym &&
      guardClauses.length < 60 &&
      !node.childForFieldName('alternative')
    ) {
      const condNode = node.childForFieldName('condition');
      const consNode = node.childForFieldName('consequence');
      const outcome = detectEarlyExitOutcome(consNode);
      if (condNode && outcome) {
        const rawCond = condNode.text.replace(/^\(|\)$/g, '');
        guardClauses.push({
          line: startLine,
          endLine,
          condition: compactOneLine(rawCond, 90),
          outcomeKind: outcome,
          enclosingSymbol: currentSym,
        });
      }
    } else if (t === 'let_declaration' && langId === 'rust' && currentSym && guardClauses.length < 60) {
      // Rust `let Some(x) = ... else { return ... };`
      const altNode = node.childForFieldName('alternative');
      const patNode = node.childForFieldName('pattern');
      const outcome = detectEarlyExitOutcome(altNode);
      if (altNode && patNode && outcome) {
        guardClauses.push({
          line: startLine,
          endLine,
          condition: compactOneLine(`!(let ${patNode.text})`, 90),
          outcomeKind: outcome,
          enclosingSymbol: currentSym,
        });
      }
    }

    for (const child of node.namedChildren) {
      visit(child, currentSym, isExportWrapper, nextContainer);
    }
  };

  visit(root);
  return { symbols, imports, guardClauses };
}

/**
 * Parses source code with Tree-sitter WASM (sub-5ms per file, cached by SHA-1)
 * and returns deterministic AST symbol spans, true imports, and guard clauses.
 * Returns `undefined` if the file extension does not have a Tree-sitter grammar.
 */
export async function extractFileAstFacts(
  filePath: string,
  content: string
): Promise<FileAstFacts | undefined> {
  const langId = detectAstLanguage(filePath);
  if (!langId) return undefined;
  if (content.length > 600_000) return undefined; // Skip giant generated files

  const hash = crypto
    .createHash('sha1')
    .update('v2:')
    .update(langId)
    .update('\0')
    .update(content)
    .digest('hex');
  const cached = astFactsCache.get(hash);
  if (cached) return cached;

  const grammar = await getGrammarLanguage(langId);
  if (!grammar) return undefined;

  const parser = new Parser();
  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(content);
    try {
      const extracted = walkAndExtract(tree.rootNode, langId);
      const facts: FileAstFacts = {
        language: langId,
        ...extracted,
      };
      if (astFactsCache.size >= MAX_AST_CACHE) {
        const oldestKey = astFactsCache.keys().next().value;
        if (oldestKey) astFactsCache.delete(oldestKey);
      }
      astFactsCache.set(hash, facts);
      return facts;
    } finally {
      tree.delete();
    }
  } catch {
    return undefined;
  } finally {
    parser.delete();
  }
}

/**
 * Builds a bounded, pre-verified AST Symbol & Guard map for `atlas_get_context`
 * so Agents receive exact 1-based `startLine..endLine` spans before writing briefings.
 */
export async function buildAstOutlineForFiles(
  repoRoot: string,
  relPaths: string[],
  maxFiles = 24
): Promise<FileAstSummary[]> {
  const targets = relPaths
    .map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter((p) => Boolean(detectAstLanguage(p)))
    .slice(0, maxFiles);

  const summaries: Array<FileAstSummary | undefined> = await Promise.all(
    targets.map(async (rel) => {
      try {
        const raw = await fs.readFile(path.join(repoRoot, rel), 'utf-8');
        const facts = await extractFileAstFacts(rel, raw);
        if (!facts) return undefined;
        return {
          path: rel,
          language: facts.language,
          symbols: facts.symbols.slice(0, 40),
          imports: [...new Set(facts.imports.map((i) => i.specifier))].slice(0, 25),
          guardClauses: facts.guardClauses.slice(0, 12),
        };
      } catch {
        return undefined;
      }
    })
  );

  return summaries.filter((s): s is FileAstSummary => Boolean(s));
}

function hasSpanLineHit(startLine: number, endLine: number, lineSet?: Set<number>): boolean {
  if (!lineSet || lineSet.size === 0) return false;
  for (const ln of lineSet) {
    if (ln >= startLine && ln <= endLine) return true;
  }
  return false;
}

function symbolKindPriority(kind: AstSymbolKind): number {
  switch (kind) {
    case 'class':
    case 'struct':
    case 'trait':
    case 'impl':
    case 'function':
      return 3;
    case 'method':
    case 'interface':
    case 'enum':
      return 2;
    case 'type':
    case 'module':
      return 1;
    case 'const':
    default:
      return 0;
  }
}

/**
 * Curates raw AST declarations + guard clauses into a high-signal, single-column
 * `File -> Symbol` structure:
 * - Merges Rust `impl Foo` methods into `struct Foo` / `enum Foo` when in the same file
 * - Groups OOP `class` / `trait` / `interface` methods into `members[]`
 * - Promotes diff-modified or claim/directive-anchored methods (and methods inside single-class files)
 * - Caps output at `maxPerFile` by importance while preserving top-to-bottom source line order
 */
export function curateFileAstFacts(params: {
  facts: FileAstFacts;
  changedLines?: Set<number>;
  anchoredLines?: Set<number>;
  maxPerFile?: number;
}): CuratedFileSymbols {
  const { facts, changedLines, anchoredLines, maxPerFile = 14 } = params;

  // Map each guard clause to the tightest enclosing symbol span
  const guardsBySymIdx = new Map<number, AstGuardClause[]>();
  for (const g of facts.guardClauses) {
    let bestIdx = -1;
    let bestSpan = Infinity;
    for (let i = 0; i < facts.symbols.length; i++) {
      const s = facts.symbols[i];
      if (g.line >= s.startLine && g.line <= s.endLine) {
        const span = s.endLine - s.startLine;
        if (span < bestSpan) {
          bestSpan = span;
          bestIdx = i;
        }
      }
    }
    if (bestIdx >= 0) {
      const list = guardsBySymIdx.get(bestIdx) ?? [];
      list.push(g);
      guardsBySymIdx.set(bestIdx, list);
    }
  }

  // Primary containers (excluding `impl` first so `struct`/`enum` wins over `impl` in Rust)
  const containersByName = new Map<string, CuratedSymbolItem>();
  const topCandidates: CuratedSymbolItem[] = [];
  const pendingImpls: Array<{ sym: AstSymbolSpan; idx: number }> = [];
  const methods: Array<{ sym: AstSymbolSpan; idx: number }> = [];

  for (let i = 0; i < facts.symbols.length; i++) {
    const s = facts.symbols[i];
    if (s.kind === 'method') {
      methods.push({ sym: s, idx: i });
      continue;
    }
    if (s.kind === 'impl') {
      pendingImpls.push({ sym: s, idx: i });
      continue;
    }

    const item: CuratedSymbolItem = {
      name: s.name,
      kind: s.kind,
      startLine: s.startLine,
      endLine: s.endLine,
      exported: s.exported,
      signature: s.signature,
      containerName: s.containerName,
      changed: hasSpanLineHit(s.startLine, s.endLine, changedLines),
      anchored: hasSpanLineHit(s.startLine, s.endLine, anchoredLines),
      guards: guardsBySymIdx.get(i) ?? [],
      members: [],
    };
    topCandidates.push(item);

    if (
      (s.kind === 'class' ||
        s.kind === 'struct' ||
        s.kind === 'enum' ||
        s.kind === 'trait' ||
        s.kind === 'interface') &&
      !containersByName.has(s.name)
    ) {
      containersByName.set(s.name, item);
    }
  }

  // Handle Rust `impl` blocks: merge into existing `struct`/`enum` if present; otherwise create consolidated `impl` container
  for (const { sym, idx } of pendingImpls) {
    const existing = containersByName.get(sym.name);
    const implChanged = hasSpanLineHit(sym.startLine, sym.endLine, changedLines);
    const implAnchored = hasSpanLineHit(sym.startLine, sym.endLine, anchoredLines);
    const implGuards = guardsBySymIdx.get(idx) ?? [];
    if (existing) {
      if (implChanged) existing.changed = true;
      if (implAnchored) existing.anchored = true;
      if (implGuards.length > 0) existing.guards.push(...implGuards);
    } else {
      const created: CuratedSymbolItem = {
        name: sym.name,
        kind: 'impl',
        startLine: sym.startLine,
        endLine: sym.endLine,
        exported: true,
        signature: sym.signature,
        changed: implChanged,
        anchored: implAnchored,
        guards: [...implGuards],
        members: [],
      };
      containersByName.set(sym.name, created);
      topCandidates.push(created);
    }
  }

  const callableTopCount = topCandidates.filter(
    (c) =>
      c.kind === 'class' ||
      c.kind === 'struct' ||
      c.kind === 'trait' ||
      c.kind === 'impl' ||
      c.kind === 'function'
  ).length;
  const expandContainerMethods = callableTopCount > 0 && callableTopCount <= 2 && topCandidates.length <= 4;

  const promotedMethods: Array<{ item: CuratedSymbolItem; exported: boolean }> = [];

  for (const { sym, idx } of methods) {
    const mGuards = guardsBySymIdx.get(idx) ?? [];
    const mChanged = hasSpanLineHit(sym.startLine, sym.endLine, changedLines);
    const mAnchored = hasSpanLineHit(sym.startLine, sym.endLine, anchoredLines);
    const parent = sym.containerName ? containersByName.get(sym.containerName) : undefined;

    if (parent) {
      parent.members.push({
        name: sym.name,
        startLine: sym.startLine,
        endLine: sym.endLine,
        signature: sym.signature,
        changed: mChanged,
        guardCount: mGuards.length,
      });
      if (mChanged) parent.changed = true;
      if (mAnchored) parent.anchored = true;

      if (mChanged || mAnchored || expandContainerMethods) {
        promotedMethods.push({
          exported: sym.exported,
          item: {
            name: `${parent.name}.${sym.name}`,
            kind: 'method',
            startLine: sym.startLine,
            endLine: sym.endLine,
            exported: sym.exported,
            signature: sym.signature,
            containerName: parent.name,
            changed: mChanged,
            anchored: mAnchored,
            guards: mGuards,
            members: [],
          },
        });
      }
    } else {
      topCandidates.push({
        name: sym.name,
        kind: 'method',
        startLine: sym.startLine,
        endLine: sym.endLine,
        exported: sym.exported,
        signature: sym.signature,
        changed: mChanged,
        anchored: mAnchored,
        guards: mGuards,
        members: [],
      });
    }
  }

  const allCandidates: CuratedSymbolItem[] = [
    ...topCandidates,
    ...promotedMethods.map((p) => p.item),
  ];
  const totalCount = allCandidates.length;

  const scoreSymbol = (item: CuratedSymbolItem): number => {
    let score = 0;
    if (item.changed) score += 10_000;
    if (item.anchored) score += 6_000;
    if (item.exported) score += 800;
    score += symbolKindPriority(item.kind) * 200;
    if (item.guards.length > 0) score += 150 + item.guards.length * 25;
    if (item.members.length > 0) score += 180 + Math.min(200, item.members.length * 20);
    const span = Math.max(1, item.endLine - item.startLine + 1);
    if (span >= 6) score += Math.min(180, span * 2);
    return score;
  };

  const ranked = [...allCandidates].sort(
    (a, b) => scoreSymbol(b) - scoreSymbol(a) || a.startLine - b.startLine
  );
  const selected = ranked
    .slice(0, maxPerFile)
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  return {
    language: facts.language,
    totalCount,
    hiddenCount: Math.max(0, totalCount - selected.length),
    symbols: selected,
  };
}

/**
 * Lazily extracts structured, diff-aware AST symbol layers ONLY for user-expanded files.
 */
export async function extractCuratedSymbolsForFiles(params: {
  repoRoot: string;
  files: string[];
  changedLinesByFile?: Map<string, Set<number>>;
  anchoredLinesByFile?: Map<string, Set<number>>;
  maxPerFile?: number;
}): Promise<Map<string, CuratedFileSymbols>> {
  const { repoRoot, files, changedLinesByFile, anchoredLinesByFile, maxPerFile = 14 } = params;
  const result = new Map<string, CuratedFileSymbols>();
  const uniqueFiles = [
    ...new Set(files.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''))),
  ].filter((p) => Boolean(detectAstLanguage(p)));

  await Promise.all(
    uniqueFiles.map(async (rel) => {
      try {
        const raw = await fs.readFile(path.join(repoRoot, rel), 'utf-8');
        const facts = await extractFileAstFacts(rel, raw);
        if (!facts) return;
        const curated = curateFileAstFacts({
          facts,
          changedLines: changedLinesByFile?.get(rel),
          anchoredLines: anchoredLinesByFile?.get(rel),
          maxPerFile,
        });
        result.set(rel, curated);
      } catch {
        // ignore unreadable/deleted file
      }
    })
  );

  return result;
}

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

function walkAndExtract(
  root: Parser.SyntaxNode,
  langId: SupportedLangId
): Omit<FileAstFacts, 'language'> {
  const symbols: AstSymbolSpan[] = [];
  const imports: AstImportRef[] = [];
  const guardClauses: AstGuardClause[] = [];

  const visit = (node: Parser.SyntaxNode, enclosingSym?: string, parentExported = false) => {
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
    const isExportWrapper = t === 'export_statement';
    const hasRustPub =
      langId === 'rust' &&
      node.children.some((c) => c.type === 'visibility_modifier' && c.text.startsWith('pub'));

    const recordSym = (
      name: string | undefined,
      kind: AstSymbolKind,
      exported: boolean,
      spanStart = startLine,
      spanEnd = endLine
    ) => {
      if (!name) return;
      symbols.push({
        name,
        kind,
        startLine: spanStart,
        endLine: spanEnd,
        exported,
      });
      currentSym = name;
    };

    if (langId === 'typescript' || langId === 'tsx' || langId === 'javascript') {
      const exp = parentExported || node.parent?.type === 'export_statement';
      const spanStart = node.parent?.type === 'export_statement' ? node.parent.startPosition.row + 1 : startLine;
      const spanEnd = node.parent?.type === 'export_statement' ? node.parent.endPosition.row + 1 : endLine;

      if (t === 'function_declaration' || t === 'generator_function_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'function', exp, spanStart, spanEnd);
      } else if (t === 'class_declaration' || t === 'abstract_class_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'class', exp, spanStart, spanEnd);
      } else if (t === 'interface_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'interface', exp, spanStart, spanEnd);
      } else if (t === 'type_alias_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'type', exp, spanStart, spanEnd);
      } else if (t === 'enum_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'enum', exp, spanStart, spanEnd);
      } else if (t === 'method_definition') {
        recordSym(node.childForFieldName('name')?.text, 'method', true);
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
                recordSym(
                  idNode.text,
                  isFnVal ? 'function' : 'const',
                  exp,
                  spanStart,
                  spanEnd
                );
              }
            }
          }
        }
      }
    } else if (langId === 'rust') {
      if (t === 'function_item') {
        const isImplMethod = node.parent?.type === 'declaration_list';
        recordSym(
          node.childForFieldName('name')?.text,
          isImplMethod ? 'method' : 'function',
          hasRustPub
        );
      } else if (t === 'struct_item') {
        recordSym(node.childForFieldName('name')?.text, 'struct', hasRustPub);
      } else if (t === 'enum_item') {
        recordSym(node.childForFieldName('name')?.text, 'enum', hasRustPub);
      } else if (t === 'trait_item') {
        recordSym(node.childForFieldName('name')?.text, 'trait', hasRustPub);
      } else if (t === 'type_item') {
        recordSym(node.childForFieldName('name')?.text, 'type', hasRustPub);
      } else if (t === 'const_item' || t === 'static_item') {
        recordSym(node.childForFieldName('name')?.text, 'const', hasRustPub);
      } else if (t === 'impl_item') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          recordSym(compactOneLine(typeNode.text, 48), 'impl', true);
        }
      }
    } else if (langId === 'python') {
      if (t === 'function_definition') {
        const nm = node.childForFieldName('name')?.text;
        const isMethod = node.parent?.parent?.type === 'class_definition';
        recordSym(nm, isMethod ? 'method' : 'function', Boolean(nm && !nm.startsWith('_')));
      } else if (t === 'class_definition') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'class', Boolean(nm && !nm.startsWith('_')));
      }
    } else if (langId === 'go') {
      if (t === 'function_declaration') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'function', Boolean(nm && /^[A-Z]/.test(nm)));
      } else if (t === 'method_declaration') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'method', Boolean(nm && /^[A-Z]/.test(nm)));
      } else if (t === 'type_spec') {
        const nm = node.childForFieldName('name')?.text;
        recordSym(nm, 'type', Boolean(nm && /^[A-Z]/.test(nm)));
      }
    } else if (langId === 'java' || langId === 'c') {
      if (t === 'class_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'class', true);
      } else if (t === 'interface_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'interface', true);
      } else if (t === 'method_declaration') {
        recordSym(node.childForFieldName('name')?.text, 'method', true);
      } else if (t === 'function_definition') {
        const decl = node.childForFieldName('declarator');
        const id = decl?.childForFieldName('declarator') ?? decl;
        if (id?.text) {
          const fnName = id.text.split('(')[0].replace(/^\*+/, '').trim();
          if (fnName) recordSym(fnName, 'function', true);
        }
      }
    }

    // 3. Guard Clauses (Early-return / Early-throw `if` without `else`, or Rust `let ... else`)
    if (
      (t === 'if_statement' || t === 'if_expression') &&
      currentSym &&
      guardClauses.length < 25 &&
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
    } else if (t === 'let_declaration' && langId === 'rust' && currentSym && guardClauses.length < 25) {
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
      visit(child, currentSym, isExportWrapper);
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

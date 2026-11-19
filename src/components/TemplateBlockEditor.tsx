import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronRight,
  Code,
  Filter,
  Italic,
  List,
  ListOrdered,
  Quote,
  Shuffle,
  Smile,
  Strikethrough,
  X,
} from 'lucide-react';
import { TemplateCondition } from '../types';
import {
  DEFAULT_DYNAMIC_OPTIONS,
  InlineSegment,
  TEMPLATE_VARIABLES,
  TemplateDocNode,
  buildDynamicToken,
  getTemplateVariableMeta,
  nextDocNodeId,
  parseInlineSegments,
  parseTemplateDocument,
  serializeInlineSegments,
  serializeTemplateDocument,
} from '../utils/templateBlocks';

const QUICK_EMOJIS = [
  '💥',
  '🔥',
  '💸',
  '❌',
  '🔗',
  '🎟️',
  '⚠️',
  '⚡',
  '✅',
  '🚨',
  '😍',
  '👉',
  '📌',
  '🛒',
  '🎁',
  '⭐',
];

type ActiveTarget =
  | { kind: 'line'; nodeId: string; segIndex: number; caret: number }
  | { kind: 'cond-then'; condId: string; lineIdx: number; segIndex: number; caret: number }
  | { kind: 'cond-else'; condId: string; lineIdx: number; segIndex: number; caret: number };

interface RichTokenLineProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onChange: (nextValue: string) => void;
  onSplitLine?: (before: string, after: string) => void;
  onBackspaceAtStart?: () => void;
  onFocusSegment: (segIndex: number, caret: number) => void;
  onOpenDynamicEditor: (segIndex: number, options: string[]) => void;
}

const RichTokenLine: React.FC<RichTokenLineProps> = ({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onSplitLine,
  onBackspaceAtStart,
  onFocusSegment,
  onOpenDynamicEditor,
}) => {
  const segments = useMemo(() => parseInlineSegments(value), [value]);
  const hasChips = segments.some((s) => s.type !== 'text');

  // Plain text line without chips: render an auto-growing textarea so long lines/URLs wrap cleanly on mobile
  if (!hasChips) {
    return (
      <div className="grid w-full min-h-[24px]">
        <div
          aria-hidden="true"
          className="invisible whitespace-pre-wrap break-words col-start-1 row-start-1 text-[14px] leading-6 py-0.5 min-h-[24px]"
        >
          {value || placeholder || ' '}
          {value.endsWith('\n') ? ' ' : ''}
        </div>
        <textarea
          rows={1}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onFocus={(e) => onFocusSegment(0, e.currentTarget.selectionStart ?? value.length)}
          onClick={(e) => onFocusSegment(0, e.currentTarget.selectionStart ?? value.length)}
          onKeyUp={(e) => onFocusSegment(0, e.currentTarget.selectionStart ?? value.length)}
          onChange={(e) => {
            const nextVal = e.target.value;
            if (nextVal.includes('\n') && onSplitLine) {
              const firstBreak = nextVal.indexOf('\n');
              onSplitLine(nextVal.slice(0, firstBreak), nextVal.slice(firstBreak + 1));
              return;
            }
            onChange(nextVal);
            onFocusSegment(0, e.target.selectionStart ?? nextVal.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSplitLine) {
              e.preventDefault();
              const start = e.currentTarget.selectionStart ?? value.length;
              const end = e.currentTarget.selectionEnd ?? value.length;
              onSplitLine(value.slice(0, start), value.slice(end));
            } else if (
              e.key === 'Backspace' &&
              onBackspaceAtStart &&
              e.currentTarget.selectionStart === 0 &&
              e.currentTarget.selectionEnd === 0
            ) {
              e.preventDefault();
              onBackspaceAtStart();
            }
          }}
          className="col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent text-[14px] leading-6 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none py-0.5"
        />
      </div>
    );
  }

  const updateSegmentValue = (segIdx: number, nextText: string) => {
    const nextSegs: InlineSegment[] = segments.map((s, i) =>
      i === segIdx && s.type === 'text' ? { type: 'text', value: nextText } : s
    );
    onChange(serializeInlineSegments(nextSegs));
  };

  const removeChipAt = (chipIdx: number) => {
    const nextSegs = segments.filter((_, i) => i !== chipIdx);
    onChange(serializeInlineSegments(nextSegs));
  };

  const handleSegmentSplit = (segIdx: number, caretStart: number, caretEnd: number) => {
    if (!onSplitLine) return;
    const targetSeg = segments[segIdx];
    if (!targetSeg || targetSeg.type !== 'text') return;
    const beforeSegs: InlineSegment[] = [
      ...segments.slice(0, segIdx),
      { type: 'text', value: targetSeg.value.slice(0, caretStart) },
    ];
    const afterSegs: InlineSegment[] = [
      { type: 'text', value: targetSeg.value.slice(caretEnd) },
      ...segments.slice(segIdx + 1),
    ];
    onSplitLine(serializeInlineSegments(beforeSegs), serializeInlineSegments(afterSegs));
  };

  return (
    <div className="flex flex-wrap items-center gap-y-1 min-h-[28px] py-0.5">
      {segments.map((seg, idx) => {
        if (seg.type === 'var') {
          const meta = getTemplateVariableMeta(seg.token);
          const label = meta?.label || seg.token;
          const chipClass =
            meta?.chipClass ||
            'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
          return (
            <span
              key={`var-${idx}-${seg.token}`}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 mx-0.5 rounded-lg border text-[13px] font-medium leading-5 select-none max-w-full ${chipClass}`}
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeChipAt(idx)}
                aria-label={`Remover variável ${label}`}
                title={`Remover ${label}`}
                className="opacity-60 hover:opacity-100 rounded p-0.5 -mr-1 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        }

        if (seg.type === 'dynamic') {
          return (
            <span
              key={`dyn-${idx}`}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 mx-0.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[13px] font-medium leading-5 select-none max-w-full"
            >
              <button
                type="button"
                onClick={() => onOpenDynamicEditor(idx, seg.options)}
                aria-label="Editar variações de conteúdo dinâmico"
                className="inline-flex items-center gap-1 hover:underline truncate"
              >
                <Shuffle className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  Conteúdo dinâmico ({seg.options.length})
                </span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeChipAt(idx)}
                aria-label="Remover conteúdo dinâmico"
                className="opacity-60 hover:opacity-100 rounded p-0.5 -mr-1 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        }

        const isLast = idx === segments.length - 1;
        const isFirstAndEmpty = idx === 0 && seg.value.length === 0;
        return (
          <span
            key={`txt-${idx}`}
            className={`inline-grid items-center align-baseline max-w-full ${
              isLast ? 'min-w-[24px] flex-1' : isFirstAndEmpty ? 'min-w-[2px]' : 'min-w-[4px]'
            }`}
          >
            <span
              aria-hidden="true"
              className="invisible whitespace-pre col-start-1 row-start-1 text-[14px] leading-6"
            >
              {seg.value || (isLast ? '  ' : '')}
            </span>
            <input
              type="text"
              size={1}
              value={seg.value}
              aria-label={`${ariaLabel} trecho ${idx + 1}`}
              onFocus={(e) => onFocusSegment(idx, e.currentTarget.selectionStart ?? seg.value.length)}
              onClick={(e) => onFocusSegment(idx, e.currentTarget.selectionStart ?? seg.value.length)}
              onKeyUp={(e) => onFocusSegment(idx, e.currentTarget.selectionStart ?? seg.value.length)}
              onChange={(e) => {
                updateSegmentValue(idx, e.target.value);
                onFocusSegment(idx, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onSplitLine) {
                  e.preventDefault();
                  const start = e.currentTarget.selectionStart ?? seg.value.length;
                  const end = e.currentTarget.selectionEnd ?? seg.value.length;
                  handleSegmentSplit(idx, start, end);
                } else if (
                  e.key === 'Backspace' &&
                  e.currentTarget.selectionStart === 0 &&
                  e.currentTarget.selectionEnd === 0
                ) {
                  if (idx > 0 && segments[idx - 1].type !== 'text') {
                    e.preventDefault();
                    removeChipAt(idx - 1);
                  } else if (idx === 0 && onBackspaceAtStart) {
                    e.preventDefault();
                    onBackspaceAtStart();
                  }
                }
              }}
              className="col-start-1 row-start-1 w-0 min-w-full bg-transparent text-[14px] leading-6 text-slate-900 dark:text-slate-100 focus:outline-none"
            />
          </span>
        );
      })}
    </div>
  );
};

interface RichTokenMultilineFieldProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (nextValue: string) => void;
  onFocusLine: (lineIdx: number, segIndex: number, caret: number) => void;
  onOpenDynamicEditor: (lineIdx: number, segIndex: number, options: string[]) => void;
}

const RichTokenMultilineField: React.FC<RichTokenMultilineFieldProps> = ({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onFocusLine,
  onOpenDynamicEditor,
}) => {
  const lines = useMemo(() => (value || '').replace(/\r\n/g, '\n').split('\n'), [value]);

  const updateLine = (lineIdx: number, nextLine: string) => {
    const next = [...lines];
    next[lineIdx] = nextLine;
    onChange(next.join('\n'));
  };

  const splitLine = (lineIdx: number, before: string, after: string) => {
    const next = [...lines];
    next.splice(lineIdx, 1, before, after);
    onChange(next.join('\n'));
    onFocusLine(lineIdx + 1, 0, 0);
  };

  const mergeLineUp = (lineIdx: number) => {
    if (lineIdx <= 0) return;
    const next = [...lines];
    const prevText = next[lineIdx - 1];
    next.splice(lineIdx - 1, 2, `${prevText}${next[lineIdx]}`);
    onChange(next.join('\n'));
    onFocusLine(lineIdx - 1, 0, prevText.length);
  };

  return (
    <div className="space-y-0.5">
      {lines.map((line, lineIdx) => (
        <RichTokenLine
          key={`subline-${lineIdx}`}
          value={line}
          placeholder={lineIdx === 0 && lines.length === 1 ? placeholder : ''}
          ariaLabel={`${ariaLabel} linha ${lineIdx + 1}`}
          onChange={(nextLine) => updateLine(lineIdx, nextLine)}
          onSplitLine={(before, after) => splitLine(lineIdx, before, after)}
          onBackspaceAtStart={lineIdx > 0 ? () => mergeLineUp(lineIdx) : undefined}
          onFocusSegment={(segIdx, caret) => onFocusLine(lineIdx, segIdx, caret)}
          onOpenDynamicEditor={(segIdx, opts) => onOpenDynamicEditor(lineIdx, segIdx, opts)}
        />
      ))}
    </div>
  );
};

export interface TemplateBlockEditorProps {
  body: string;
  conditions: TemplateCondition[];
  onChange: (nextBody: string, nextConditions: TemplateCondition[]) => void;
}

export const TemplateBlockEditor: React.FC<TemplateBlockEditorProps> = ({
  body,
  conditions,
  onChange,
}) => {
  const parsed = useMemo(() => parseTemplateDocument(body, conditions), [body, conditions]);
  const { nodes, conditions: activeConditions } = parsed;

  const condMap = useMemo(
    () => new Map(activeConditions.map((c) => [c.id, c])),
    [activeConditions]
  );

  const [expandedElseIds, setExpandedElseIds] = useState<Record<string, boolean>>({});
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [dynamicEditModal, setDynamicEditModal] = useState<{
    target:
      | { kind: 'line'; nodeId: string; segIndex: number }
      | { kind: 'cond-then'; condId: string; lineIdx: number; segIndex: number }
      | { kind: 'cond-else'; condId: string; lineIdx: number; segIndex: number };
    draftText: string;
  } | null>(null);

  const activeTargetRef = useRef<ActiveTarget | null>(null);

  const commit = (nextNodes: TemplateDocNode[], nextConditions: TemplateCondition[]) => {
    const serialized = serializeTemplateDocument(nextNodes, nextConditions);
    onChange(serialized.body, serialized.conditions);
  };

  const updateCondition = (
    condId: string,
    updater: (cond: TemplateCondition) => TemplateCondition
  ) => {
    const nextConds = activeConditions.map((c) => (c.id === condId ? updater(c) : c));
    commit(nodes, nextConds);
  };

  const updateLineNode = (nodeId: string, nextText: string) => {
    const nextNodes = nodes.map((n) =>
      n.id === nodeId && n.type === 'line' ? { ...n, text: nextText } : n
    );
    commit(nextNodes, activeConditions);
  };

  const updateConditionPrefix = (nodeId: string, nextPrefix: string) => {
    const nextNodes = nodes.map((n) =>
      n.id === nodeId && n.type === 'condition' ? { ...n, prefix: nextPrefix } : n
    );
    commit(nextNodes, activeConditions);
  };

  const splitLineNode = (nodeIndex: number, before: string, after: string) => {
    const target = nodes[nodeIndex];
    if (!target || target.type !== 'line') return;
    const newId = nextDocNodeId('line');
    const nextNodes = [...nodes];
    nextNodes.splice(
      nodeIndex,
      1,
      { ...target, text: before },
      { type: 'line', id: newId, text: after }
    );
    activeTargetRef.current = { kind: 'line', nodeId: newId, segIndex: 0, caret: 0 };
    commit(nextNodes, activeConditions);
  };

  const mergeLineNodeUp = (nodeIndex: number) => {
    if (nodeIndex <= 0) return;
    const current = nodes[nodeIndex];
    const prev = nodes[nodeIndex - 1];
    if (!current || current.type !== 'line') return;

    if (prev.type === 'line') {
      const nextNodes = [...nodes];
      const mergedText = `${prev.text}${current.text}`;
      nextNodes.splice(nodeIndex - 1, 2, { ...prev, text: mergedText });
      activeTargetRef.current = {
        kind: 'line',
        nodeId: prev.id,
        segIndex: 0,
        caret: prev.text.length,
      };
      commit(nextNodes, activeConditions);
    } else if (current.text === '' && nodes.length > 1) {
      // Remove empty blank line right after a conditional block
      const nextNodes = nodes.filter((_, idx) => idx !== nodeIndex);
      commit(nextNodes, activeConditions);
    }
  };

  const moveNode = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= nodes.length) return;
    const nextNodes = [...nodes];
    const [moved] = nextNodes.splice(index, 1);
    nextNodes.splice(targetIdx, 0, moved);
    commit(nextNodes, activeConditions);
  };

  const removeConditionNode = (nodeId: string, condId: string) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextConds = activeConditions.filter((c) => c.id !== condId);
    if (nextNodes.length === 0) {
      nextNodes.push({ type: 'line', id: nextDocNodeId('line'), text: '' });
    }
    commit(nextNodes, nextConds);
  };

  const insertTokenIntoLineString = (
    lineText: string,
    segIndex: number,
    caret: number,
    inserted: string
  ): string => {
    const segs = parseInlineSegments(lineText);
    const targetSeg = segs[segIndex];
    if (targetSeg && targetSeg.type === 'text') {
      const safeCaret = Math.max(0, Math.min(caret, targetSeg.value.length));
      const nextVal =
        targetSeg.value.slice(0, safeCaret) + inserted + targetSeg.value.slice(safeCaret);
      const nextSegs = segs.map((s, i) =>
        i === segIndex ? ({ type: 'text', value: nextVal } as InlineSegment) : s
      );
      return serializeInlineSegments(nextSegs);
    }
    return lineText ? `${lineText} ${inserted}` : inserted;
  };

  const handleInsertTextOrToken = (inserted: string) => {
    const target = activeTargetRef.current;

    if (target?.kind === 'cond-then') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.thenText || '').split('\n');
        const safeLineIdx = Math.max(0, Math.min(target.lineIdx, lines.length - 1));
        lines[safeLineIdx] = insertTokenIntoLineString(
          lines[safeLineIdx] || '',
          target.segIndex,
          target.caret,
          inserted
        );
        updateCondition(cond.id, (c) => ({ ...c, thenText: lines.join('\n') }));
        return;
      }
    }

    if (target?.kind === 'cond-else') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.elseText || '').split('\n');
        const safeLineIdx = Math.max(0, Math.min(target.lineIdx, lines.length - 1));
        lines[safeLineIdx] = insertTokenIntoLineString(
          lines[safeLineIdx] || '',
          target.segIndex,
          target.caret,
          inserted
        );
        setExpandedElseIds((prev) => ({ ...prev, [cond.id]: true }));
        updateCondition(cond.id, (c) => ({ ...c, elseText: lines.join('\n') }));
        return;
      }
    }

    if (target?.kind === 'line') {
      const node = nodes.find((n) => n.id === target.nodeId && n.type === 'line');
      if (node && node.type === 'line') {
        const nextText = insertTokenIntoLineString(
          node.text,
          target.segIndex,
          target.caret,
          inserted
        );
        updateLineNode(node.id, nextText);
        return;
      }
    }

    // Fallback: insert on the last text line, or append a new line
    const lastLineNode = [...nodes].reverse().find((n) => n.type === 'line');
    if (lastLineNode && lastLineNode.type === 'line') {
      const sep = lastLineNode.text.length > 0 && !lastLineNode.text.endsWith(' ') ? ' ' : '';
      updateLineNode(lastLineNode.id, `${lastLineNode.text}${sep}${inserted}`);
    } else {
      const newId = nextDocNodeId('line');
      commit([...nodes, { type: 'line', id: newId, text: inserted }], activeConditions);
    }
  };

  const handleInsertDynamicContent = () => {
    handleInsertTextOrToken(buildDynamicToken(DEFAULT_DYNAMIC_OPTIONS));
  };

  const handleAddConditionBlock = () => {
    const newCondId = `cond-${Date.now().toString(36)}`;
    const newCond: TemplateCondition = {
      id: newCondId,
      variable: 'desconto_pct',
      operator: 'maior_que',
      compareValue: 0,
      thenText: 'De: ~{{preco_original}}~ ❌',
      elseText: '',
    };
    const newNode: TemplateDocNode = {
      type: 'condition',
      id: nextDocNodeId('cond'),
      condId: newCondId,
      prefix: '',
      suffix: '',
    };

    const target = activeTargetRef.current;
    let insertAt = nodes.length;
    if (target?.kind === 'line') {
      const idx = nodes.findIndex((n) => n.id === target.nodeId);
      if (idx >= 0) insertAt = idx + 1;
    } else if (target?.kind === 'cond-then' || target?.kind === 'cond-else') {
      const idx = nodes.findIndex((n) => n.type === 'condition' && n.condId === target.condId);
      if (idx >= 0) insertAt = idx + 1;
    }

    const nextNodes = [...nodes];
    nextNodes.splice(insertAt, 0, newNode);
    // Ensure there's always an editable text line after the last conditional card
    if (insertAt === nextNodes.length - 1) {
      nextNodes.push({ type: 'line', id: nextDocNodeId('line'), text: '' });
    }
    commit(nextNodes, [...activeConditions, newCond]);
  };

  const handleApplyFormatting = (
    action: 'bold' | 'italic' | 'strike' | 'code' | 'uppercase' | 'bullet' | 'numbered' | 'quote'
  ) => {
    const target = activeTargetRef.current;

    const transformLine = (text: string): string => {
      switch (action) {
        case 'bold':
          return text.trim() ? `*${text.trim()}*` : '*destaque*';
        case 'italic':
          return text.trim() ? `_${text.trim()}_` : '_itálico_';
        case 'strike':
          return text.trim() ? `~${text.trim()}~` : '~riscado~';
        case 'code':
          return text.trim() ? `\`${text.trim()}\`` : '`cupom`';
        case 'uppercase': {
          // Only uppercase plain text outside {{...}} tokens
          const segs = parseInlineSegments(text);
          const hasLower = segs.some(
            (s) => s.type === 'text' && s.value !== s.value.toUpperCase()
          );
          return serializeInlineSegments(
            segs.map((s) =>
              s.type === 'text'
                ? { type: 'text', value: hasLower ? s.value.toUpperCase() : s.value.toLowerCase() }
                : s
            )
          );
        }
        case 'bullet':
          return text.startsWith('• ') ? text.slice(2) : `• ${text}`;
        case 'numbered':
          return /^\d+\.\s/.test(text) ? text.replace(/^\d+\.\s/, '') : `1. ${text}`;
        case 'quote':
          return text.startsWith('> ') ? text.slice(2) : `> ${text}`;
      }
    };

    if (target?.kind === 'cond-then') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.thenText || '').split('\n');
        const idx = Math.max(0, Math.min(target.lineIdx, lines.length - 1));
        lines[idx] = transformLine(lines[idx] || '');
        updateCondition(cond.id, (c) => ({ ...c, thenText: lines.join('\n') }));
        return;
      }
    }

    if (target?.kind === 'cond-else') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.elseText || '').split('\n');
        const idx = Math.max(0, Math.min(target.lineIdx, lines.length - 1));
        lines[idx] = transformLine(lines[idx] || '');
        updateCondition(cond.id, (c) => ({ ...c, elseText: lines.join('\n') }));
        return;
      }
    }

    if (target?.kind === 'line') {
      const node = nodes.find((n) => n.id === target.nodeId && n.type === 'line');
      if (node && node.type === 'line') {
        updateLineNode(node.id, transformLine(node.text));
        return;
      }
    }

    // Fallback for inline format buttons when no field is focused
    const sampleMap: Record<typeof action, string> = {
      bold: '*destaque*',
      italic: '_itálico_',
      strike: '~riscado~',
      code: '`cupom`',
      uppercase: '',
      bullet: '• ',
      numbered: '1. ',
      quote: '> ',
    };
    if (sampleMap[action]) {
      handleInsertTextOrToken(sampleMap[action]);
    }
  };

  const handleSaveDynamicOptions = () => {
    if (!dynamicEditModal) return;
    const options = dynamicEditModal.draftText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const nextToken = buildDynamicToken(options);
    const { target } = dynamicEditModal;

    const replaceSegmentInLine = (lineText: string, segIdx: number) => {
      const segs = parseInlineSegments(lineText);
      if (segs[segIdx]?.type === 'dynamic') {
        const nextSegs: InlineSegment[] = segs.map((s, i) =>
          i === segIdx
            ? { type: 'dynamic', rawToken: nextToken, options: options.length ? options : DEFAULT_DYNAMIC_OPTIONS }
            : s
        );
        return serializeInlineSegments(nextSegs);
      }
      return lineText;
    };

    if (target.kind === 'line') {
      const node = nodes.find((n) => n.id === target.nodeId && n.type === 'line');
      if (node && node.type === 'line') {
        updateLineNode(node.id, replaceSegmentInLine(node.text, target.segIndex));
      }
    } else if (target.kind === 'cond-then') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.thenText || '').split('\n');
        lines[target.lineIdx] = replaceSegmentInLine(lines[target.lineIdx] || '', target.segIndex);
        updateCondition(cond.id, (c) => ({ ...c, thenText: lines.join('\n') }));
      }
    } else if (target.kind === 'cond-else') {
      const cond = condMap.get(target.condId);
      if (cond) {
        const lines = (cond.elseText || '').split('\n');
        lines[target.lineIdx] = replaceSegmentInLine(lines[target.lineIdx] || '', target.segIndex);
        updateCondition(cond.id, (c) => ({ ...c, elseText: lines.join('\n') }));
      }
    }
    setDynamicEditModal(null);
  };

  const conditionCount = nodes.filter((n) => n.type === 'condition').length;
  let runningCondNumber = 0;

  return (
    <div className="space-y-3.5">
      {/* Variáveis Disponíveis + Botões BuboFlow (Conteúdo dinâmico & Condicional Se/Senão) */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Variáveis Disponíveis (clique para inserir)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((chip) => (
            <button
              key={chip.token}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleInsertTextOrToken(chip.token)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors active:scale-95 ${chip.buttonClass}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleInsertDynamicContent}
            className="px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Conteúdo dinâmico</span>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleAddConditionBlock}
            className="px-3 py-1.5 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/40 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Condicional (Se/Senão)</span>
            <span
              data-testid="conditional-count-badge"
              className="px-1.5 py-0.5 rounded-md bg-sky-200/80 dark:bg-sky-900 text-sky-900 dark:text-sky-100 text-[11px] font-bold tabular-nums leading-none"
            >
              {conditionCount}
            </span>
          </button>
        </div>
      </div>

      {/* Unified Conteúdo do Template Editor (Blocos Condicionais + Chips + Texto em ordem real) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-semibold text-slate-900 dark:text-white">
            Conteúdo do Template
          </label>
          <span className="text-[11px] text-slate-400">
            Enter pula linha · clique nas variáveis para inserir
          </span>
        </div>

        <div
          data-testid="template-content-editor"
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-xs"
        >
          {/* Document Body Area */}
          <div className="p-3 sm:p-4 space-y-1 min-h-[260px]">
            {nodes.map((node, nodeIdx) => {
              if (node.type === 'line') {
                return (
                  <div key={node.id} className="w-full">
                    <RichTokenLine
                      value={node.text}
                      placeholder={
                        nodes.length === 1
                          ? 'Escreva seu template aqui ou clique nas variáveis acima...'
                          : ''
                      }
                      ariaLabel={`Linha ${nodeIdx + 1} do conteúdo do template`}
                      onChange={(nextText) => updateLineNode(node.id, nextText)}
                      onSplitLine={(before, after) => splitLineNode(nodeIdx, before, after)}
                      onBackspaceAtStart={
                        nodeIdx > 0 ? () => mergeLineNodeUp(nodeIdx) : undefined
                      }
                      onFocusSegment={(segIdx, caret) => {
                        activeTargetRef.current = {
                          kind: 'line',
                          nodeId: node.id,
                          segIndex: segIdx,
                          caret,
                        };
                      }}
                      onOpenDynamicEditor={(segIdx, opts) =>
                        setDynamicEditModal({
                          target: { kind: 'line', nodeId: node.id, segIndex: segIdx },
                          draftText: opts.join('\n'),
                        })
                      }
                    />
                  </div>
                );
              }

              const cond = condMap.get(node.condId);
              if (!cond) return null;
              runningCondNumber += 1;
              const condNumber = runningCondNumber;
              const isNumericVar = cond.variable === 'desconto_pct';
              const isNumericOp =
                isNumericVar &&
                (cond.operator === 'maior_que' ||
                  cond.operator === 'menor_que' ||
                  cond.operator === 'igual_a');
              const hasElseValue = Boolean(cond.elseText && cond.elseText.length > 0);
              const isElseExpanded =
                expandedElseIds[cond.id] !== undefined
                  ? expandedElseIds[cond.id]
                  : hasElseValue;

              return (
                <div
                  key={node.id}
                  data-testid={`inline-cond-block-${condNumber}`}
                  className="flex items-start gap-1.5 py-1"
                >
                  {node.prefix.trim().length > 0 && (
                    <input
                      type="text"
                      value={node.prefix.trimEnd()}
                      aria-label={`Prefixo do bloco SE (${condNumber})`}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateConditionPrefix(node.id, val ? `${val} ` : '');
                      }}
                      className="w-8 pt-2 text-center text-base bg-transparent rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-300 shrink-0"
                    />
                  )}

                  <div className="flex-1 min-w-0 rounded-xl border border-sky-200 dark:border-sky-800/80 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(14,116,144,0.06)]">
                    {/* SE Header Row */}
                    <div className="bg-sky-50/90 dark:bg-sky-950/50 px-2 py-1.5 flex flex-wrap items-center gap-1 border-b border-sky-100 dark:border-sky-900/60">
                      <span className="px-1.5 py-0.5 rounded-md bg-sky-200/80 dark:bg-sky-900 text-sky-800 dark:text-sky-200 text-[11px] font-bold tracking-wide">
                        SE
                      </span>
                      <span className="text-xs font-semibold text-sky-700 dark:text-sky-300 tabular-nums mr-0.5">
                        ({condNumber})
                      </span>

                      <select
                        value={cond.variable}
                        aria-label={`Variável da condição SE (${condNumber})`}
                        onChange={(e) => {
                          const nextVar = e.target.value as TemplateCondition['variable'];
                          updateCondition(cond.id, (c) => ({
                            ...c,
                            variable: nextVar,
                            operator: nextVar === 'desconto_pct' ? 'maior_que' : 'existe',
                            compareValue: nextVar === 'desconto_pct' ? c.compareValue ?? 0 : undefined,
                          }));
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px] font-medium text-slate-800 dark:text-slate-100 max-w-full"
                      >
                        <option value="cta_ia">CTA por IA</option>
                        <option value="desconto_pct">% de desconto</option>
                        <option value="cupom">Cupom</option>
                        <option value="info_extra">Informação adicional</option>
                      </select>

                      <select
                        value={cond.operator === 'sempre' ? 'existe' : cond.operator}
                        aria-label={`Operador da condição SE (${condNumber})`}
                        onChange={(e) => {
                          const nextOp = e.target.value as TemplateCondition['operator'];
                          updateCondition(cond.id, (c) => ({
                            ...c,
                            operator: nextOp,
                            compareValue:
                              nextOp === 'maior_que' ||
                              nextOp === 'menor_que' ||
                              nextOp === 'igual_a'
                                ? c.compareValue ?? 0
                                : undefined,
                          }));
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px] font-medium text-slate-800 dark:text-slate-100"
                      >
                        {isNumericVar ? (
                          <>
                            <option value="maior_que">maior que</option>
                            <option value="menor_que">menor que</option>
                            <option value="igual_a">igual a</option>
                            <option value="existe">existe</option>
                            <option value="nao_existe">não existe</option>
                          </>
                        ) : (
                          <>
                            <option value="existe">existe</option>
                            <option value="nao_existe">não existe</option>
                          </>
                        )}
                      </select>

                      {isNumericOp && (
                        <input
                          type="number"
                          value={cond.compareValue ?? 0}
                          aria-label={`Valor de comparação da condição SE (${condNumber})`}
                          onChange={(e) =>
                            updateCondition(cond.id, (c) => ({
                              ...c,
                              compareValue: Number(e.target.value || 0),
                            }))
                          }
                          className="w-12 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px] font-medium text-slate-800 dark:text-slate-100 tabular-nums"
                        />
                      )}

                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={nodeIdx === 0}
                          onClick={() => moveNode(nodeIdx, -1)}
                          aria-label={`Mover bloco SE (${condNumber}) para cima`}
                          title="Mover para cima"
                          className="p-1 rounded hover:bg-sky-100 dark:hover:bg-sky-900/50 text-slate-500 disabled:opacity-25"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={nodeIdx === nodes.length - 1}
                          onClick={() => moveNode(nodeIdx, 1)}
                          aria-label={`Mover bloco SE (${condNumber}) para baixo`}
                          title="Mover para baixo"
                          className="p-1 rounded hover:bg-sky-100 dark:hover:bg-sky-900/50 text-slate-500 disabled:opacity-25"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeConditionNode(node.id, cond.id)}
                          aria-label={`Remover bloco SE (${condNumber})`}
                          title="Remover bloco condicional"
                          className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* THEN Editable Row (with inline variable chips) */}
                    <div className="px-3 py-2 bg-white dark:bg-slate-900">
                      <RichTokenMultilineField
                        value={cond.thenText}
                        placeholder="Texto se verdadeiro (clique nas variáveis acima)..."
                        ariaLabel={`Conteúdo SE (${condNumber})`}
                        onChange={(nextVal) =>
                          updateCondition(cond.id, (c) => ({ ...c, thenText: nextVal }))
                        }
                        onFocusLine={(lineIdx, segIdx, caret) => {
                          activeTargetRef.current = {
                            kind: 'cond-then',
                            condId: cond.id,
                            lineIdx,
                            segIndex: segIdx,
                            caret,
                          };
                        }}
                        onOpenDynamicEditor={(lineIdx, segIdx, opts) =>
                          setDynamicEditModal({
                            target: {
                              kind: 'cond-then',
                              condId: cond.id,
                              lineIdx,
                              segIndex: segIdx,
                            },
                            draftText: opts.join('\n'),
                          })
                        }
                      />
                    </div>

                    {/* Collapsible SENÃO Toggle + Editable Row */}
                    <div className="border-t border-sky-100 dark:border-sky-900/60 bg-sky-50/55 dark:bg-sky-950/25">
                      <button
                        type="button"
                        aria-expanded={isElseExpanded}
                        onClick={() =>
                          setExpandedElseIds((prev) => ({
                            ...prev,
                            [cond.id]: !isElseExpanded,
                          }))
                        }
                        className="w-full px-3 py-1.5 flex items-center gap-1.5 text-left text-xs hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-colors"
                      >
                        {isElseExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                        )}
                        <span className="font-bold text-sky-700 dark:text-sky-300">
                          SENÃO
                        </span>
                        <span className="text-slate-400 font-normal">
                          {isElseExpanded ? 'opcional' : 'clique para adicionar'}
                        </span>
                      </button>

                      {isElseExpanded && (
                        <div className="px-3 py-2 bg-white dark:bg-slate-900 border-t border-sky-100/80 dark:border-sky-900/50">
                          <RichTokenMultilineField
                            value={cond.elseText || ''}
                            placeholder="Texto se falso (opcional)..."
                            ariaLabel={`Conteúdo SENÃO (${condNumber})`}
                            onChange={(nextVal) =>
                              updateCondition(cond.id, (c) => ({ ...c, elseText: nextVal }))
                            }
                            onFocusLine={(lineIdx, segIdx, caret) => {
                              activeTargetRef.current = {
                                kind: 'cond-else',
                                condId: cond.id,
                                lineIdx,
                                segIndex: segIdx,
                                caret,
                              };
                            }}
                            onOpenDynamicEditor={(lineIdx, segIdx, opts) =>
                              setDynamicEditModal({
                                target: {
                                  kind: 'cond-else',
                                  condId: cond.id,
                                  lineIdx,
                                  segIndex: segIdx,
                                },
                                draftText: opts.join('\n'),
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Attached Bottom Formatting Toolbar (matches BuboFlow footer strip) */}
          <div className="bg-slate-100/80 dark:bg-slate-800/90 border-t border-slate-200 dark:border-slate-700 px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1 text-slate-700 dark:text-slate-200">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('bold')}
                aria-label="Negrito"
                title="Negrito (*texto*)"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('italic')}
                aria-label="Itálico"
                title="Itálico (_texto_)"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('strike')}
                aria-label="Tachado"
                title="Tachado (~texto~)"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <Strikethrough className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('code')}
                aria-label="Código monoespaçado"
                title="Monoespaçado (`texto`)"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <Code className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('uppercase')}
                aria-label="Alternar maiúsculas"
                title="Alternar MAIÚSCULAS / minúsculas"
                className="px-1.5 py-1 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700 text-xs font-bold tracking-tight"
              >
                AB
              </button>

              <span className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1" />

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('bullet')}
                aria-label="Lista com marcadores"
                title="Lista com marcadores"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('numbered')}
                aria-label="Lista numerada"
                title="Lista numerada"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <ListOrdered className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleApplyFormatting('quote')}
                aria-label="Citação"
                title="Citação (> texto)"
                className="p-1.5 rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700"
              >
                <Quote className="w-4 h-4" />
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmojiPickerOpen((prev) => !prev)}
                aria-label="Inserir emoji"
                aria-expanded={emojiPickerOpen}
                title="Inserir emoji"
                className={`p-1.5 rounded-lg transition-colors ${
                  emojiPickerOpen
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'hover:bg-slate-200/80 dark:hover:bg-slate-700'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>
            </div>

            {emojiPickerOpen && (
              <div className="flex flex-wrap gap-1 pt-1.5 border-t border-slate-200/80 dark:border-slate-700">
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      handleInsertTextOrToken(em);
                      setEmojiPickerOpen(false);
                    }}
                    aria-label={`Inserir emoji ${em}`}
                    className="w-8 h-8 rounded-lg hover:bg-white dark:hover:bg-slate-700 flex items-center justify-center text-base transition-colors"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline Editor for Conteúdo Dinâmico variations */}
      {dynamicEditModal && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <Shuffle className="w-3.5 h-3.5" />
              Variações do Conteúdo Dinâmico (1 por linha)
            </span>
            <button
              type="button"
              onClick={() => setDynamicEditModal(null)}
              aria-label="Fechar editor de conteúdo dinâmico"
              className="p-1 rounded text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            rows={3}
            value={dynamicEditModal.draftText}
            onChange={(e) =>
              setDynamicEditModal((prev) =>
                prev ? { ...prev, draftText: e.target.value } : null
              )
            }
            placeholder="Uma frase por linha..."
            className="w-full rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 p-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDynamicEditModal(null)}
              className="px-2.5 py-1 rounded-lg text-xs text-slate-600 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveDynamicOptions}
              className="px-3 py-1 rounded-lg bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              Aplicar variações
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

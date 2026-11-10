/**
 * File/folder icons for the explorer (spec §7.1 — common file types).
 * Pure inline SVG: no icon dependency, no network, no emoji (consistent
 * rendering across Windows/Linux/macOS and both themes).
 */
import type { ReactNode } from 'react';
import type { FileKind } from '../../../shared/ipc-types';

interface IconStyle {
  color: string;
  /** Short monogram drawn inside the document (max 2 characters). */
  label?: string;
}

const EXTENSION_ICONS: Readonly<Record<string, IconStyle>> = {
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#3178c6', label: 'TX' },
  js: { color: '#e8c442', label: 'JS' },
  jsx: { color: '#e8c442', label: 'JS' },
  mjs: { color: '#e8c442', label: 'JS' },
  cjs: { color: '#e8c442', label: 'JS' },
  json: { color: '#d5bd4a', label: '{}' },
  html: { color: '#e44d26', label: '<>' },
  htm: { color: '#e44d26', label: '<>' },
  xml: { color: '#e44d26', label: '<>' },
  css: { color: '#42a5f5', label: '#' },
  scss: { color: '#cf6f9e', label: '#' },
  md: { color: '#8b99ad', label: 'M' },
  markdown: { color: '#8b99ad', label: 'M' },
  py: { color: '#4b8bbe', label: 'PY' },
  java: { color: '#b07219', label: 'J' },
  c: { color: '#73a7c9', label: 'C' },
  h: { color: '#73a7c9', label: 'H' },
  cpp: { color: '#5382a1', label: 'C+' },
  cc: { color: '#5382a1', label: 'C+' },
  hpp: { color: '#5382a1', label: 'H+' },
  rs: { color: '#dea584', label: 'RS' },
  go: { color: '#3fb4d8', label: 'GO' },
  sh: { color: '#6fca70', label: '$' },
  bash: { color: '#6fca70', label: '$' },
  sql: { color: '#4a9ed8', label: 'DB' },
  yml: { color: '#c76f83', label: 'Y' },
  yaml: { color: '#c76f83', label: 'Y' },
  toml: { color: '#9c6b4e', label: 'T' },
  vue: { color: '#41b883', label: 'V' },
};

const DEFAULT_STYLE: IconStyle = { color: '#7d8590' };

function styleFor(fileName: string): IconStyle {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) {
    // No extension, or a dot-file like `.gitignore`.
    return DEFAULT_STYLE;
  }
  return EXTENSION_ICONS[lower.slice(dot + 1)] ?? DEFAULT_STYLE;
}

interface FileIconProps {
  name: string;
  kind: FileKind;
  expanded: boolean;
}

export function FileIcon({ name, kind, expanded }: FileIconProps): ReactNode {
  if (kind === 'directory') {
    return (
      <svg
        className={`tree-node__icon tree-node__icon--folder${
          expanded ? ' tree-node__icon--folder-open' : ''
        }`}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M3.5 6.2A1.7 1.7 0 0 1 5.2 4.5h3.4l2 2.6h8.2a1.7 1.7 0 0 1 1.7 1.7v8.5a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"
          fill="currentColor"
          opacity={expanded ? 0.95 : 0.7}
        />
      </svg>
    );
  }

  const { color, label } = styleFor(name);
  return (
    <svg
      className="tree-node__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={{ color }}
      aria-hidden="true"
    >
      <path
        d="M6 3.5h7.2L18.5 8.8V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M13 3.8v5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {label ? (
        <text
          x="12"
          y="17.4"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill="currentColor"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}

/**
 * File/folder icons for the explorer and editor tabs.
 *
 * All shapes live in the shared inline-SVG icons module. This file only maps
 * extensions to a colour, a glyph family and an optional monogram: no icon
 * dependency, no network, no emoji and no copied vendor artwork.
 */
import type { ReactNode } from 'react';
import type { FileKind } from '../../../shared/ipc-types';
import { FileTypeIcon, Icon, type FileGlyph } from '../../components/ui/icons';

interface IconStyle {
  color: string;
  /** Short monogram drawn inside the document (max 2 characters). */
  label?: string;
  glyph: FileGlyph;
}

const EXTENSION_ICONS: Readonly<Record<string, IconStyle>> = {
  ts: { color: '#519aba', label: 'TS', glyph: 'code' },
  tsx: { color: '#519aba', label: 'TX', glyph: 'code' },
  js: { color: '#cbcb41', label: 'JS', glyph: 'code' },
  jsx: { color: '#cbcb41', label: 'JS', glyph: 'code' },
  mjs: { color: '#cbcb41', label: 'JS', glyph: 'code' },
  cjs: { color: '#cbcb41', label: 'JS', glyph: 'code' },
  json: { color: '#cbcb41', label: '{}', glyph: 'data' },
  jsonc: { color: '#cbcb41', label: '{}', glyph: 'data' },
  html: { color: '#e37933', label: '<>', glyph: 'markup' },
  htm: { color: '#e37933', label: '<>', glyph: 'markup' },
  xml: { color: '#e37933', label: '<>', glyph: 'markup' },
  svg: { color: '#e37933', label: '<>', glyph: 'image' },
  vue: { color: '#8dc149', label: 'V', glyph: 'markup' },
  css: { color: '#519aba', label: '#', glyph: 'style' },
  scss: { color: '#c74e39', label: '#', glyph: 'style' },
  less: { color: '#519aba', label: '#', glyph: 'style' },
  md: { color: '#9aa0a6', label: 'M', glyph: 'doc' },
  markdown: { color: '#9aa0a6', label: 'M', glyph: 'doc' },
  txt: { color: '#9aa0a6', glyph: 'doc' },
  py: { color: '#759ab3', label: 'PY', glyph: 'script' },
  java: { color: '#cc3e44', label: 'J', glyph: 'code' },
  c: { color: '#519aba', label: 'C', glyph: 'code' },
  h: { color: '#a074c4', label: 'H', glyph: 'code' },
  cpp: { color: '#519aba', label: 'C+', glyph: 'code' },
  cc: { color: '#519aba', label: 'C+', glyph: 'code' },
  hpp: { color: '#a074c4', label: 'H+', glyph: 'code' },
  cs: { color: '#596706', label: 'C#', glyph: 'code' },
  rs: { color: '#dea584', label: 'RS', glyph: 'code' },
  go: { color: '#519aba', label: 'GO', glyph: 'code' },
  sh: { color: '#89d185', label: '$', glyph: 'script' },
  bash: { color: '#89d185', label: '$', glyph: 'script' },
  ps1: { color: '#539bf5', label: 'PS', glyph: 'script' },
  sql: { color: '#e37933', label: 'DB', glyph: 'data' },
  yml: { color: '#c74e39', label: 'Y', glyph: 'config' },
  yaml: { color: '#c74e39', label: 'Y', glyph: 'config' },
  toml: { color: '#c74e39', label: 'T', glyph: 'config' },
  ini: { color: '#c74e39', glyph: 'config' },
  env: { color: '#cbcb41', glyph: 'config' },
  lock: { color: '#9aa0a6', glyph: 'config' },
  png: { color: '#c74e39', glyph: 'image' },
  jpg: { color: '#c74e39', glyph: 'image' },
  jpeg: { color: '#c74e39', glyph: 'image' },
  gif: { color: '#c74e39', glyph: 'image' },
  webp: { color: '#c74e39', glyph: 'image' },
  ico: { color: '#c74e39', glyph: 'image' },
  zip: { color: '#cbcb41', glyph: 'archive' },
  gz: { color: '#cbcb41', glyph: 'archive' },
  tar: { color: '#cbcb41', glyph: 'archive' },
};

const DEFAULT_STYLE: IconStyle = { color: '#9d9d9d', glyph: 'default' };

function styleFor(fileName: string): IconStyle {
  const lower = fileName.toLowerCase();
  if (lower === '.gitignore' || lower === '.gitattributes') {
    return { color: '#c74e39', glyph: 'config' };
  }
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) {
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
      <Icon
        name={expanded ? 'folderOpen' : 'folderClosed'}
        size={16}
        className="tree-node__icon tree-node__icon--folder"
      />
    );
  }
  const { color, label, glyph } = styleFor(name);
  return (
    <FileTypeIcon
      glyph={glyph}
      color={color}
      label={label}
      className="tree-node__icon"
    />
  );
}

import React, { useEffect, useRef } from 'react';
import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import './YamlEditor.scss';

/**
 * YamlEditor - A reusable syntax-highlighted YAML editor using CodeMirror 6
 *
 * Props:
 * - value: YAML string to display
 * - onChange: (newValue: string) => void
 * - readOnly: boolean, default false
 * - error: { message, mark?: { line, column } } - parse error to display
 * - height: CSS height, default '500px'
 */
function YamlEditor({ value = '', onChange, readOnly = false, error = null, height = '500px' }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);

  // Keep the onChange ref current without recreating the editor
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create the editor once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      yaml(),
      oneDark,
      EditorView.theme({
        '&': { height },
        '.cm-scroller': { overflow: 'auto' },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
      extensions.push(EditorView.editable.of(false));
    }

    const state = EditorState.create({
      doc: value || '',
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount/unmount - readOnly and height are stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, height]);

  // Sync external value changes (e.g. revert) to the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (value !== currentContent) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: value || '',
        },
      });
    }
  }, [value]);

  return (
    <div className="yaml-editor-wrapper">
      {error && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          title="YAML Parse Error"
          color="red"
          variant="light"
          mb="sm"
        >
          {error.message}
          {error.mark && (
            <span> (line {error.mark.line}, column {error.mark.column})</span>
          )}
        </Alert>
      )}
      <div
        className="yaml-editor-container"
        style={{ height }}
        ref={containerRef}
      />
    </div>
  );
}

export default YamlEditor;

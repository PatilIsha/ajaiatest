function Btn({ onClick, active, disabled, label, children }) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="tb-sep" aria-hidden="true" />;

export default function Toolbar({ editor, onInsertFile }) {
  if (!editor) return null;
  const chain = () => editor.chain().focus();

  const blockValue = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p';

  function setBlock(value) {
    if (value === 'p') chain().setParagraph().run();
    else chain().setHeading({ level: Number(value[1]) }).run();
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!editor.can().undo()}>↶</Btn>
      <Btn label="Redo (Ctrl+Shift+Z)" onClick={() => chain().redo().run()} disabled={!editor.can().redo()}>↷</Btn>
      <Sep />
      <select
        className="tb-select"
        value={blockValue}
        onChange={(e) => setBlock(e.target.value)}
        aria-label="Text style"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <Sep />
      <Btn label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Btn label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <Sep />
      <Btn label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>
        • List
      </Btn>
      <Btn label="Numbered list" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>
        1. List
      </Btn>
      <Btn label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </Btn>
      <Sep />
      <Btn label="Insert content from a .txt, .md or .docx file at the cursor" onClick={onInsertFile}>
        ⤓ Insert file
      </Btn>
    </div>
  );
}

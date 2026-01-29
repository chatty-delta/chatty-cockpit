<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'text-rose-400 underline' }
    }),
    Placeholder.configure({
      placeholder: props.placeholder || 'Schreibe hier...'
    })
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[200px] p-3'
    }
  },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getHTML())
  }
})

watch(() => props.modelValue, (newVal) => {
  if (editor.value && editor.value.getHTML() !== newVal) {
    editor.value.commands.setContent(newVal, { emitUpdate: false })
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function setLink() {
  const url = prompt('URL eingeben:')
  if (url) {
    editor.value?.chain().focus().setLink({ href: url }).run()
  }
}
</script>

<template>
  <div class="border border-gray-700 rounded-lg overflow-hidden bg-gray-800">
    <!-- Toolbar -->
    <div v-if="editor" class="flex flex-wrap gap-1 p-2 border-b border-gray-700 bg-gray-800/50">
      <button
        type="button"
        @click="editor.chain().focus().toggleBold().run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('bold') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Fett"
      >B</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleItalic().run()"
        :class="['px-2 py-1 rounded text-sm italic', editor.isActive('italic') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Kursiv"
      >I</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleStrike().run()"
        :class="['px-2 py-1 rounded text-sm line-through', editor.isActive('strike') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Durchgestrichen"
      >S</button>
      
      <div class="w-px bg-gray-700 mx-1"></div>
      
      <button
        type="button"
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('heading', { level: 1 }) ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Überschrift 1"
      >H1</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('heading', { level: 2 }) ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Überschrift 2"
      >H2</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('heading', { level: 3 }) ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Überschrift 3"
      >H3</button>
      
      <div class="w-px bg-gray-700 mx-1"></div>
      
      <button
        type="button"
        @click="editor.chain().focus().toggleBulletList().run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('bulletList') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Liste"
      >• Liste</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleOrderedList().run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('orderedList') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Nummerierte Liste"
      >1. Liste</button>
      
      <div class="w-px bg-gray-700 mx-1"></div>
      
      <button
        type="button"
        @click="editor.chain().focus().toggleCodeBlock().run()"
        :class="['px-2 py-1 rounded text-sm font-mono', editor.isActive('codeBlock') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Code Block"
      >&lt;/&gt;</button>
      <button
        type="button"
        @click="editor.chain().focus().toggleBlockquote().run()"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('blockquote') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Zitat"
      >"</button>
      <button
        type="button"
        @click="setLink"
        :class="['px-2 py-1 rounded text-sm', editor.isActive('link') ? 'bg-rose-500/30 text-rose-300' : 'hover:bg-gray-700 text-gray-400']"
        title="Link"
      >🔗</button>
    </div>
    
    <!-- Editor Content -->
    <EditorContent :editor="editor" class="min-h-[250px]" />
  </div>
</template>

<style>
/* Tiptap editor styles */
.ProseMirror {
  min-height: 200px;
  padding: 12px;
}

.ProseMirror p.is-editor-empty:first-child::before {
  color: #6b7280;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.ProseMirror:focus {
  outline: none;
}

.ProseMirror h1 { font-size: 1.5rem; font-weight: bold; margin: 1rem 0 0.5rem; }
.ProseMirror h2 { font-size: 1.25rem; font-weight: bold; margin: 1rem 0 0.5rem; }
.ProseMirror h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
.ProseMirror p { margin: 0.5rem 0; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5rem; margin: 0.5rem 0; }
.ProseMirror li { margin: 0.25rem 0; }
.ProseMirror blockquote { border-left: 3px solid #f43f5e; padding-left: 1rem; margin: 0.5rem 0; color: #9ca3af; }
.ProseMirror pre { background: #1f2937; padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.5rem 0; }
.ProseMirror code { background: #1f2937; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875rem; }
.ProseMirror pre code { background: none; padding: 0; }
.ProseMirror a { color: #f43f5e; text-decoration: underline; }
</style>

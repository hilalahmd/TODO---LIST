import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const FILTERS = ['All', 'Active', 'Completed', 'Schedule', 'Bin']

const PRIORITIES = [
  { label: 'Low',    color: '#c8c8c8' },
  { label: 'Medium', color: '#8a8a8a' },
  { label: 'High',   color: '#000000' },
]

function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

/* ─── useClock ─────────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/* ─── useTodos ─────────────────────────────────────────────── */
function useTodos() {
  const [todos, setTodos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zara-todos-v3') || '[]') }
    catch { return [] }
  })
  const [bin, setBin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zara-bin-v3') || '[]') }
    catch { return [] }
  })

  useEffect(() => { localStorage.setItem('zara-todos-v3', JSON.stringify(todos)) }, [todos])
  useEffect(() => { localStorage.setItem('zara-bin-v3',   JSON.stringify(bin))   }, [bin])

  const addTodo = (text, priority = 'Medium', dueDate = null) => {
    if (!text.trim()) return
    setTodos(prev => [{
      id: generateId(),
      text: text.trim(),
      completed: false,
      priority,
      dueDate,
      createdAt: Date.now(),
      notified: false,
    }, ...prev])
  }

  const toggleTodo = id =>
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))

  const deleteTodo = id => {
    setTodos(prev => {
      const index = prev.findIndex(t => t.id === id)
      if (index === -1) return prev
      const item = prev[index]
      setBin(b => [{ ...item, deletedAt: Date.now(), originalIndex: index }, ...b])
      return prev.filter((_, i) => i !== index)
    })
  }

  const editTodo = (id, text) =>
    setTodos(prev => prev.map(t => t.id === id ? { ...t, text } : t))

  const setDueDate = (id, dueDate) =>
    setTodos(prev => prev.map(t => t.id === id ? { ...t, dueDate, notified: false } : t))

  const markNotified = useCallback((id) =>
    setTodos(prev => prev.map(t => t.id === id ? { ...t, notified: true } : t)), [])

  const clearCompleted = () => {
    setTodos(prev => {
      const toRemove = prev.filter(t => t.completed)
      setBin(b => [
        ...toRemove.map(item => ({
          ...item, deletedAt: Date.now(),
          originalIndex: prev.findIndex(t => t.id === item.id),
        })),
        ...b,
      ])
      return prev.filter(t => !t.completed)
    })
  }

  const restoreFromBin = id => {
    setBin(prev => {
      const item = prev.find(t => t.id === id)
      if (!item) return prev
      const { deletedAt, originalIndex, ...restored } = item
      setTodos(ts => {
        const clamped = Math.min(originalIndex, ts.length)
        const next = [...ts]
        next.splice(clamped, 0, restored)
        return next
      })
      return prev.filter(t => t.id !== id)
    })
  }

  const permanentDelete = id => setBin(prev => prev.filter(t => t.id !== id))
  const emptyBin = () => setBin([])

  const reorderTodo = (fromIndex, toIndex) => {
    setTodos(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  return {
    todos, bin,
    addTodo, toggleTodo, deleteTodo, editTodo, setDueDate,
    markNotified, clearCompleted, reorderTodo,
    restoreFromBin, permanentDelete, emptyBin,
  }
}

/* ─── useOverdueNotifications ──────────────────────────────── */
function useOverdueNotifications(todos, markNotified) {
  useEffect(() => {
    const check = () => {
      const now = Date.now()
      todos.forEach(todo => {
        if (!todo.dueDate || todo.completed || todo.notified) return
        if (new Date(todo.dueDate).getTime() <= now) {
          markNotified(todo.id)
          if (Notification.permission === 'granted') {
            new Notification('⏰ Task overdue', {
              body: todo.text,
              icon: '/vite.svg',
              tag: todo.id,
            })
          }
        }
      })
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [todos, markNotified])
}

/* ─── Helpers ──────────────────────────────────────────────── */
function formatDueDate(dueDate, now) {
  if (!dueDate) return null
  const due = new Date(dueDate)
  const diff = due - now
  const isOverdue = diff < 0
  const timeStr = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const dayAfterStart = new Date(tomorrowStart); dayAfterStart.setDate(dayAfterStart.getDate() + 1)

  if (isOverdue) {
    const minsAgo = Math.abs(Math.floor(diff / 60000))
    if (minsAgo < 60) return { text: `Overdue · ${minsAgo}m ago`, overdue: true }
    const hrsAgo = Math.floor(minsAgo / 60)
    if (hrsAgo < 24) return { text: `Overdue · ${hrsAgo}h ago`, overdue: true }
    return { text: `Overdue · ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, overdue: true }
  }
  if (due >= todayStart && due < tomorrowStart) return { text: `Today · ${timeStr}`, overdue: false }
  if (due >= tomorrowStart && due < dayAfterStart) return { text: `Tomorrow · ${timeStr}`, overdue: false }
  return {
    text: `${due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeStr}`,
    overdue: false,
  }
}

function getScheduleGroup(dueDate, now) {
  if (!dueDate) return 'unscheduled'
  const due = new Date(dueDate)
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(todayStart.getDate() + 1)
  const dayAfterStart = new Date(tomorrowStart); dayAfterStart.setDate(dayAfterStart.getDate() + 1)
  const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7)

  if (due < todayStart)      return 'overdue'
  if (due < tomorrowStart)   return 'today'
  if (due < dayAfterStart)   return 'tomorrow'
  if (due < weekEnd)         return 'this-week'
  return 'later'
}

const GROUP_ORDER  = ['overdue', 'today', 'tomorrow', 'this-week', 'later', 'unscheduled']
const GROUP_LABELS = {
  overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow',
  'this-week': 'This Week', later: 'Later', unscheduled: 'Unscheduled',
}

/* ─── ProgressRing ────────────────────────────────────────── */
function ProgressRing({ total, completed }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  const r    = 20
  const circ = 2 * Math.PI * r
  const fill = (pct / 100) * circ
  return (
    <div className="progress-ring">
      <svg viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r={r} stroke="#E5E4DF" strokeWidth="3" className="track" />
        <circle
          cx="24" cy="24" r={r}
          stroke="#D95F2B" strokeWidth="3"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          className="fill"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '24px 24px', transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <span className="pct">{pct}%</span>
    </div>
  )
}

/* ─── PriorityDot ──────────────────────────────────────────── */
function PriorityDot({ priority }) {
  return <span className="priority-dot" title={priority} />
}

/* ─── DueDateDisplay ───────────────────────────────────────── */
function DueDateDisplay({ dueDate, onEdit, now }) {
  const fmt = formatDueDate(dueDate, now)
  if (!fmt) return (
    <button className="due-tag add-due" onClick={onEdit}>+ Due date</button>
  )
  return (
    <button className={`due-tag${fmt.overdue ? ' overdue' : ''}`} onClick={onEdit} title="Click to change">
      <svg viewBox="0 0 12 12" fill="none">
        <rect x="1" y="2" width="10" height="9" stroke="currentColor" strokeWidth="1" />
        <path d="M1 5h10M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
      {fmt.text}
    </button>
  )
}

/* ─── Countdown ───────────────────────────────────────────── */
function Countdown({ dueDate, now, completed }) {
  if (!dueDate || completed) return null

  const due      = new Date(dueDate)
  const diff     = due - now
  const isOver   = diff < 0
  const abs      = Math.abs(diff)
  const totalSec = Math.floor(abs / 1000)
  const sec      = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min      = totalMin % 60
  const totalHr  = Math.floor(totalMin / 60)
  const hr       = totalHr % 24
  const days     = Math.floor(totalHr / 24)

  let text, level

  if (isOver) {
    if (totalMin < 1)       text = 'just now'
    else if (totalHr < 1)   text = `${totalMin}m overdue`
    else if (days < 1)      text = `${totalHr}h ${min}m overdue`
    else                    text = `${days}d overdue`
    level = 'overdue'
  } else {
    if (days >= 7)          { text = `${days}d left`;                    level = 'safe'    }
    else if (days >= 1)     { text = `${days}d ${hr}h left`;             level = 'safe'    }
    else if (totalHr >= 3)  { text = `${hr}h ${min}m left`;              level = 'safe'    }
    else if (totalHr >= 1)  { text = `${hr}h ${min}m left`;              level = 'warning' }
    else if (totalMin >= 1) { text = `${min}m ${sec}s left`;             level = 'danger'  }
    else                    { text = `${totalSec}s left`;                 level = 'danger'  }
  }

  return (
    <span className={`countdown countdown-${level}`}>
      {!isOver ? (
        <svg viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6 3.5V6l1.8 1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6 4v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="8.2" r="0.6" fill="currentColor" />
        </svg>
      )}
      {text}
    </span>
  )
}

/* ─── TodoItem ─────────────────────────────────────────────── */
function TodoItem({ todo, onToggle, onDelete, onEdit, onSetDueDate, index, onDragStart, onDragOver, onDrop, now }) {
  const [editing, setEditing]       = useState(false)
  const [draft, setDraft]           = useState(todo.text)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft]   = useState(todo.dueDate ? new Date(todo.dueDate).toISOString().slice(0, 16) : '')
  const inputRef = useRef(null)
  const dateRef  = useRef(null)

  useEffect(() => { if (editing)     inputRef.current?.focus() }, [editing])
  useEffect(() => { if (editingDate) dateRef.current?.showPicker?.() }, [editingDate])

  const handleEditSave = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== todo.text) onEdit(todo.id, trimmed)
    else setDraft(todo.text)
    setEditing(false)
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter')  handleEditSave()
    if (e.key === 'Escape') { setDraft(todo.text); setEditing(false) }
  }

  const handleDateSave = () => {
    onSetDueDate(todo.id, dateDraft ? new Date(dateDraft).toISOString() : null)
    setEditingDate(false)
  }

  const openDateEdit = () => {
    setDateDraft(todo.dueDate ? new Date(todo.dueDate).toISOString().slice(0, 16) : '')
    setEditingDate(true)
  }

  const isOverdue = todo.dueDate && !todo.completed && new Date(todo.dueDate) < now

  return (
    <li
      className={`todo-item${todo.completed ? ' completed' : ''}${isOverdue ? ' is-overdue' : ''}`}
      data-priority={todo.priority}
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
    >
      <div className="todo-main">
        <button
          className={`check-btn${todo.completed ? ' checked' : ''}`}
          onClick={() => onToggle(todo.id)}
          aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {todo.completed && (
            <svg viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <PriorityDot priority={todo.priority} />

        <div className="todo-content">
          {editing ? (
            <input
              ref={inputRef}
              className="edit-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={handleEditSave}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <span
              className="todo-text"
              onDoubleClick={() => !todo.completed && setEditing(true)}
              title="Double-click to edit"
            >
              {todo.text}
            </span>
          )}

          {editingDate ? (
            <div className="date-edit-row">
              <input
                ref={dateRef}
                type="datetime-local"
                className="date-input"
                value={dateDraft}
                onChange={e => setDateDraft(e.target.value)}
                onBlur={handleDateSave}
                onKeyDown={e => {
                  if (e.key === 'Enter')  handleDateSave()
                  if (e.key === 'Escape') setEditingDate(false)
                }}
              />
              {dateDraft && (
                <button className="clear-date-btn" onClick={() => {
                  onSetDueDate(todo.id, null)
                  setDateDraft('')
                  setEditingDate(false)
                }}>
                  Clear
                </button>
              )}
            </div>
          ) : (
            <DueDateDisplay dueDate={todo.dueDate} onEdit={openDateEdit} now={now} />
          )}
        </div>

        {todo.dueDate && (
          <Countdown dueDate={todo.dueDate} now={now} completed={todo.completed} />
        )}

        <button className="delete-btn" onClick={() => onDelete(todo.id)} aria-label="Move to bin">
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </li>
  )
}

/* ─── BinItem ──────────────────────────────────────────────── */
function BinItem({ item, onRestore, onDelete, now }) {
  const timeAgo = (() => {
    // Guard: if deletedAt is missing or 0 (corrupted data), show 'Just now'
    if (!item.deletedAt || item.deletedAt <= 0) return 'Just now'

    const diff = now.getTime() - item.deletedAt

    // Guard: if diff is negative or unreasonably large (>30 days), show date instead
    if (diff < 0) return 'Just now'
    if (diff > 30 * 24 * 60 * 60 * 1000) {
      return new Date(item.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    const mins = Math.floor(diff / 60000)
    if (mins < 1)  return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  })()

  return (
    <li className="todo-item bin-item">
      <div className="todo-main">
        <PriorityDot priority={item.priority} />
        <div className="todo-content">
          <span className="todo-text bin-text">{item.text}</span>
          {item.dueDate && (
            <span className="due-tag" style={{ opacity: 0.45 }}>
              <svg viewBox="0 0 12 12" fill="none">
                <rect x="1" y="2" width="10" height="9" stroke="currentColor" strokeWidth="1" />
                <path d="M1 5h10M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
              {new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <span className="bin-time">{timeAgo}</span>
        <button className="restore-btn" onClick={() => onRestore(item.id)}>
          <svg viewBox="0 0 14 14" fill="none">
            <path d="M2 7a5 5 0 1 0 1.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M2 3.5V7h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Restore
        </button>
        <button className="delete-btn" onClick={() => onDelete(item.id)}>
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </li>
  )
}

/* ─── AddTodoBar ───────────────────────────────────────────── */
function AddTodoBar({ onAdd, prefillDate }) {
  const [text, setText]         = useState('')
  const [priority, setPriority] = useState('Medium')
  const [dueDate, setDueDate]   = useState(prefillDate || '')
  const [open, setOpen]         = useState(false)
  const inputRef = useRef(null)
  const formRef  = useRef(null)

  useEffect(() => { if (prefillDate) setDueDate(prefillDate) }, [prefillDate])

  const handleSubmit = e => {
    e.preventDefault()
    if (!text.trim()) return
    if (dueDate && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    onAdd(text, priority, dueDate ? new Date(dueDate).toISOString() : null)
    setText('')
    setDueDate(prefillDate || '')
    setOpen(false)
  }

  // Only close the options panel when focus leaves the entire form
  const handleFormBlur = e => {
    if (!formRef.current?.contains(e.relatedTarget)) {
      setOpen(false)
    }
  }

  return (
    <form
      ref={formRef}
      className="add-bar"
      onSubmit={handleSubmit}
      onBlur={handleFormBlur}
    >
      <div className="add-row">
        <button type="button" className="add-icon-btn" onClick={() => { inputRef.current?.focus() }}>
          <svg viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={inputRef}
          className="add-input"
          placeholder="Add new task"
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {text && (
          <button type="submit" className="submit-btn">
            <svg viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="add-options">
          <div className="priority-row">
            {PRIORITIES.map(p => (
              <button
                key={p.label}
                type="button"
                className={`priority-btn${priority === p.label ? ' active' : ''}`}
                onClick={() => setPriority(p.label)}
              >
                <span className="dot" style={{ background: priority === p.label ? '#000' : p.color }} />
                {p.label}
              </button>
            ))}
          </div>
          <div className="due-row">
            <label className="due-label">Due</label>
            <input
              type="datetime-local"
              className="date-input inline"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
            {dueDate && (
              <button type="button" className="clear-date-btn" onClick={() => setDueDate('')}>Clear</button>
            )}
          </div>
        </div>
      )}
    </form>
  )
}

/* ─── OverdueBanner ────────────────────────────────────────── */
function OverdueBanner({ count, onView }) {
  if (count === 0) return null
  return (
    <div className="overdue-banner">
      <span>
        <svg viewBox="0 0 14 14" fill="none" className="banner-icon">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 4v3.2l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {count} task{count !== 1 ? 's' : ''} overdue
      </span>
      <button onClick={onView}>View schedule</button>
    </div>
  )
}

/* ─── ScheduleView ─────────────────────────────────────────── */
function ScheduleView({ todos, now, onToggle, onDelete, onEdit, onSetDueDate }) {
  const groups = {}
  todos.filter(t => !t.completed).forEach(t => {
    const g = getScheduleGroup(t.dueDate, now)
    if (!groups[g]) groups[g] = []
    groups[g].push(t)
  })

  if (!Object.keys(groups).length) return (
    <div className="empty">
      <svg viewBox="0 0 64 64" fill="none" className="empty-icon">
        <rect x="8" y="12" width="48" height="44" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 24h48M20 8v8M44 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p>No scheduled tasks</p>
    </div>
  )

  return (
    <div className="schedule-view">
      {GROUP_ORDER.filter(g => groups[g]?.length).map(group => (
        <div key={group} className="schedule-group">
          <div className={`schedule-label${group === 'overdue' ? ' overdue-label' : ''}`}>
            {GROUP_LABELS[group]}
            <span className="group-count">{groups[group].length}</span>
          </div>
          <ul className="todo-list">
            {groups[group].map((todo, i) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                index={i}
                onToggle={onToggle}
                onDelete={onDelete}
                onEdit={onEdit}
                onSetDueDate={onSetDueDate}
                onDragStart={() => {}}
                onDragOver={() => {}}
                onDrop={() => {}}
                now={now}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/* ─── App ──────────────────────────────────────────────────── */
export default function App() {
  const {
    todos, bin,
    addTodo, toggleTodo, deleteTodo, editTodo, setDueDate,
    markNotified, clearCompleted, reorderTodo,
    restoreFromBin, permanentDelete, emptyBin,
  } = useTodos()

  const now    = useClock()
  useOverdueNotifications(todos, markNotified)

  const [filter, setFilter] = useState('All')
  const dragItem     = useRef(null)
  const dragOverItem = useRef(null)

  // Tasks visible today = no due date OR due today or earlier (overdue)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  const isForToday = t => !t.dueDate || new Date(t.dueDate) <= todayEnd

  const filtered = todos.filter(t => {
    if (filter === 'Active')    return !t.completed && isForToday(t)
    if (filter === 'Completed') return  t.completed
    return isForToday(t)   // 'All' — hides tomorrow+ tasks
  })

  const todayActiveCount  = todos.filter(t => !t.completed && isForToday(t)).length
  const futureCount       = todos.filter(t => !t.completed && !isForToday(t)).length
  const activeCount       = todos.filter(t => !t.completed).length
  const completedCount    = todos.filter(t =>  t.completed).length
  const binCount          = bin.length
  const overdueCount      = todos.filter(t => !t.completed && t.dueDate && new Date(t.dueDate) < now).length

  const handleDragStart = (e, i) => { dragItem.current = i; e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver  = (e, i) => { e.preventDefault(); dragOverItem.current = i }
  const handleDrop      = ()     => {
    if (dragItem.current === null || dragOverItem.current === null) return
    reorderTodo(dragItem.current, dragOverItem.current)
    dragItem.current = null; dragOverItem.current = null
  }

  // Pre-fill tomorrow 9 AM when in Schedule tab
  const prefillDate = (() => {
    if (filter !== 'Schedule') return ''
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })()

  const clockStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const headingText = () => {
    if (filter === 'Bin')      return 'Bin'
    if (filter === 'Schedule') return 'Schedule'
    if (todayActiveCount === 0 && todos.length > 0 && futureCount === 0) return 'All done 🎉'
    if (todayActiveCount === 0) return 'Today'
    return `${todayActiveCount} for today`
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="header-top">
            <p className="date">{dateStr}</p>
            <span className="clock">{clockStr}</span>
          </div>
          <h1 className="title">{headingText()}</h1>
        </div>
        <ProgressRing total={todos.length} completed={completedCount} />
      </header>

      <OverdueBanner count={overdueCount} onView={() => setFilter('Schedule')} />

      {filter !== 'Bin' && (
        <AddTodoBar onAdd={addTodo} prefillDate={prefillDate} />
      )}

      <nav className="filter-nav">
        {FILTERS.map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f}
            {f === 'Bin'       && binCount        > 0 && <span className="badge">{binCount}</span>}
            {f === 'Completed' && completedCount   > 0 && <span className="badge">{completedCount}</span>}
            {f === 'Active'    && todayActiveCount > 0 && <span className="badge">{todayActiveCount}</span>}
            {f === 'Schedule'  && (overdueCount > 0 || futureCount > 0) && (
              <span className={`badge${overdueCount > 0 ? ' overdue-badge' : ''}`}>
                {overdueCount > 0 ? overdueCount : futureCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Bin ─────────────────────────── */}
      {filter === 'Bin' ? (
        bin.length === 0 ? (
          <div className="empty">
            <svg viewBox="0 0 64 64" fill="none" className="empty-icon">
              <rect x="8" y="16" width="48" height="40" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 16h56M22 16V8h20v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M26 28v16M32 28v16M38 28v16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p>Bin is empty</p>
          </div>
        ) : (
          <>
            <p className="bin-hint">Items can be restored to their original position.</p>
            <ul className="todo-list">
              {bin.map(item => (
                <BinItem key={item.id} item={item} now={now} onRestore={restoreFromBin} onDelete={permanentDelete} />
              ))}
            </ul>
            <button className="clear-btn" onClick={emptyBin}>Empty bin ({binCount})</button>
          </>
        )

      /* ── Schedule ───────────────────── */
      ) : filter === 'Schedule' ? (
        <ScheduleView
          todos={todos}
          now={now}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          onEdit={editTodo}
          onSetDueDate={setDueDate}
        />

      /* ── Normal List ────────────────── */
      ) : (
        <>
          {filtered.length === 0 ? (
            <div className="empty">
              <svg viewBox="0 0 64 64" fill="none" className="empty-icon">
                <rect x="8" y="8" width="48" height="48" stroke="currentColor" strokeWidth="1.5" />
                <path d="M20 32h24M32 20v24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <p>
                {filter === 'Completed'
                  ? 'No completed tasks'
                  : filter === 'Active'
                  ? 'No active tasks for today'
                  : futureCount > 0
                  ? `Nothing for today — ${futureCount} task${futureCount !== 1 ? 's' : ''} scheduled later`
                  : 'No tasks for today'}
              </p>
              {(filter === 'All' || filter === 'Active') && futureCount > 0 && (
                <button
                  className="clear-btn"
                  style={{ marginTop: 4 }}
                  onClick={() => setFilter('Schedule')}
                >
                  View schedule →
                </button>
              )}
            </div>
          ) : (
            <ul className="todo-list">
              {filtered.map((todo, index) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  index={index}
                  onToggle={toggleTodo}
                  onDelete={deleteTodo}
                  onEdit={editTodo}
                  onSetDueDate={setDueDate}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  now={now}
                />
              ))}
            </ul>
          )}

          {completedCount > 0 && filter !== 'Active' && (
            <button className="clear-btn" onClick={clearCompleted}>
              Clear completed ({completedCount})
            </button>
          )}
        </>
      )}
    </div>
  )
}

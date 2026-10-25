import { useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonNodeType, JsonTreeNode } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'

const defaults: Record<JsonNodeType, string> = {
  object: '{}',
  array: '[]',
  string: '""',
  number: '0',
  boolean: 'false',
  null: 'null',
}
const nodeTypes = Object.keys(defaults) as JsonNodeType[]

interface Props {
  node: JsonTreeNode
  parent: JsonTreeNode | undefined
  rawValue: string | null
  disabled: boolean
  onCommand: (command: TreeCommand) => void
  onLocate: () => void
  structuralActions?: ReactNode
}

export function TreeNodeForm({
  node,
  parent,
  rawValue,
  disabled,
  onCommand,
  onLocate,
  structuralActions,
}: Props): React.JSX.Element {
  const [key, setKey] = useState(node.key ?? '')
  const [type, setType] = useState<JsonNodeType>(node.type)
  const [value, setValue] = useState<string | null>(rawValue)
  const [newKey, setNewKey] = useState('newKey')
  const [newType, setNewType] = useState<JsonNodeType>('string')
  const [newValue, setNewValue] = useState('""')
  const send = (command: TreeCommand): void => {
    if (!disabled) onCommand(command)
  }
  return (
    <div className="tree-form">
      <button className="locate-node" disabled={disabled} onClick={onLocate}>
        定位文本
      </button>
      <fieldset disabled={disabled}>
        <legend>编辑选中节点</legend>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send({
              kind: 'update',
              nodeId: node.id,
              ...(parent?.type === 'object' && key !== node.key ? { key } : {}),
              ...(value !== null && (value !== rawValue || type !== node.type)
                ? { valueText: value, valueType: type }
                : {}),
            })
          }}
        >
          {parent?.type === 'object' && (
            <label>
              属性名
              <input
                aria-label="属性名"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
          )}
          <label>
            类型
            <select
              aria-label="节点类型"
              value={type}
              onChange={(event) => {
                const next = event.target.value as JsonNodeType
                setType(next)
                setValue(defaults[next])
              }}
            >
              {nodeTypes.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            JSON 值
            <textarea
              aria-label="节点 JSON 值"
              rows={2}
              value={value ?? ''}
              disabled={value === null}
              placeholder="值较长或树已过期，请在文本区编辑"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <p className="tree-hint">切换类型会使用默认值；点击应用才替换原值。</p>
          <div className="tree-form-actions">
            <button type="submit">应用节点修改</button>
            <button
              type="button"
              disabled={!parent}
              onClick={() => send({ kind: 'delete', nodeId: node.id })}
            >
              删除节点
            </button>
          </div>
        </form>
        {(node.type === 'object' || node.type === 'array') && (
          <form
            className="tree-add"
            onSubmit={(event) => {
              event.preventDefault()
              send({
                kind: 'add',
                nodeId: node.id,
                valueText: newValue,
                valueType: newType,
                ...(node.type === 'object' ? { key: newKey } : {}),
              })
            }}
          >
            <h3>新增子节点{node.type === 'array' ? `（追加到 [${node.children.length}]）` : ''}</h3>
            {node.type === 'object' && (
              <label>
                新属性名
                <input
                  aria-label="新属性名"
                  value={newKey}
                  onChange={(event) => setNewKey(event.target.value)}
                />
              </label>
            )}
            <label>
              新节点类型
              <select
                aria-label="新节点类型"
                value={newType}
                onChange={(event) => {
                  const next = event.target.value as JsonNodeType
                  setNewType(next)
                  setNewValue(defaults[next])
                }}
              >
                {nodeTypes.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              新节点 JSON 值
              <textarea
                aria-label="新节点 JSON 值"
                rows={2}
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
              />
            </label>
            <button type="submit">新增子节点</button>
          </form>
        )}
        {structuralActions}
      </fieldset>
    </div>
  )
}

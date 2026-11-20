import { type Item } from './catalog.ts'

export function Plush({ item, muted = false }: { item: Item; muted?: boolean }) {
  const { imageKey: kind, color, rarity } = item
  const fill = muted ? '#b4a5a0' : color
  const ink = muted ? fill : '#593b37'
  const light = muted ? fill : '#fff3dd'
  return <svg viewBox="0 0 64 64" aria-hidden="true">
    <g fill={fill} stroke={ink} strokeWidth="1.6" strokeLinejoin="round">
      {kind === 'rabbit' && <><ellipse cx="23" cy="15" rx="6" ry="14" transform="rotate(-13 23 15)"/><ellipse cx="41" cy="15" rx="6" ry="14" transform="rotate(13 41 15)"/></>}
      {kind === 'cat' && <path d="M13 33 14 12 28 21H36L50 12 51 33Z"/>}
      {(kind === 'bear' || kind === 'frog') && <><circle cx="17" cy="24" r="9"/><circle cx="47" cy="24" r="9"/></>}
      <ellipse cx="32" cy="41" rx="23" ry="19"/>
      {kind === 'dog' && <><ellipse cx="12" cy="35" rx="6" ry="12" transform="rotate(15 12 35)"/><ellipse cx="52" cy="35" rx="6" ry="12" transform="rotate(-15 52 35)"/></>}
    </g>
    {(kind === 'penguin' || kind === 'dog' || kind === 'bear') && <ellipse cx="32" cy="46" rx="15" ry="11" fill={light}/>}
    <g fill={ink}><circle cx="24" cy="38" r="2.2"/><circle cx="40" cy="38" r="2.2"/><path d="M29 44q3 4 6 0q-3-3-6 0"/></g>
    <g fill={muted ? fill : '#f58d91'}><ellipse cx="18" cy="45" rx="3" ry="2"/><ellipse cx="46" cy="45" rx="3" ry="2"/></g>
    {rarity !== '일반' && <path d="m42 50 2-4 2 4 4 2-4 2-2 4-2-4-4-2z" fill={light}/>}
  </svg>
}

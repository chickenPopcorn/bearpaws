const pads = [
  { x: 32, y: 132, finger: 1, angle: -40 },
  { x: 52, y: 66, finger: 2, angle: -12 },
  { x: 97, y: 49, finger: 3, angle: -2 },
  { x: 143, y: 59, finger: 4, angle: 12 },
  { x: 182, y: 92, finger: 5, angle: 24 },
];

export function BearPaw({ hand }: { hand: "left" | "right" }) {
  const left = hand === "left";
  return (
    <svg
      className="bear-paw"
      viewBox="-12 -12 244 284"
      role="img"
      aria-label={`Playful ${hand} bear paw finger guide: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger`}
    >
      <g
        className="bear-paw-wave"
        style={{ animationDelay: left ? "0s" : "0.3s" }}
      >
        <g transform={left ? "translate(220 0) scale(-1 1)" : undefined}>
          <path
            d="M67 238 L64 224 C44 214 30 196 25 175 C10 169 5 155 8 140 C10 121 20 109 32 108 C28 100 29 86 34 76 C25 59 28 39 42 30 C57 21 72 30 77 44 C76 26 84 12 98 12 C112 12 123 24 124 41 C132 26 148 23 160 34 C171 44 173 59 168 72 C182 61 198 70 205 85 C212 102 204 117 199 122 C212 141 211 165 201 185 C189 208 172 219 153 226 C160 235 153 244 144 238 C141 248 133 250 126 242 C119 251 111 252 104 244 C96 251 88 249 83 241 C74 247 65 246 67 238 Z"
            className="bear-paw-outline"
          />
          <path
            d="M78 157 C68 154 67 141 76 135 C85 130 95 136 95 145 C108 139 123 140 137 146 C138 136 149 131 158 138 C165 145 161 156 153 160 C164 182 153 201 133 208 C110 215 83 208 71 192 C62 178 67 165 78 157 Z"
            className="bear-paw-pad"
          />
          <g className="bear-paw-face">
            <ellipse cx="115" cy="185" rx="17" ry="12" />
            <circle cx="96" cy="170" r="3.3" />
            <circle cx="134" cy="170" r="3.3" />
            <path d="M110 181 Q115 177 120 181 Q119 186 115 186 Q111 186 110 181" />
            <path
              className="bear-paw-smile"
              d="M115 185 V188 M108 188 Q115 196 122 188"
            />
          </g>
          <path
            d="M47 173 L50 180 M177 173 L173 181 M93 219 Q113 224 134 217"
            fill="none"
            className="bear-paw-fur"
            strokeLinecap="round"
          />
        </g>
        {pads.map(({ x, y, finger, angle }, index) => (
          <g key={finger} transform={`translate(${left ? 220 - x : x} ${y})`}>
            <g
              className="bear-paw-digit"
              style={{ animationDelay: `${(left ? 0 : 0.3) + index * 0.06}s` }}
            >
              <g transform={`rotate(${left ? -angle : angle})`}>
                <path
                  d="M-6 -19 Q-7 -25 0 -28 Q7 -24 6 -19 Q0 -16 -6 -19 Z"
                  className="bear-paw-claw"
                />
                <ellipse rx="16" ry="21" className="bear-paw-pad" />
              </g>
              <text
                y="6"
                textAnchor="middle"
                className="bear-paw-number"
                fontSize="23"
                fontWeight="700"
              >
                {finger}
              </text>
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}

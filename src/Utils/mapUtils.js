// src/utils/mapUtils.js
export function bandsToCaseExpression(propName, bandsObj, fallback = '#cccccc') {
  const entries = Object.entries(bandsObj || {});
  if (entries.length === 0) return fallback;

  const expr = ['case'];
  const value = ['to-number', ['get', propName]];

  entries.forEach(([color, [min, max]]) => {
    expr.push(['all', ['>=', value, Number(min)], ['<=', value, Number(max)]], color);
  });

  expr.push(fallback);
  return expr;
}

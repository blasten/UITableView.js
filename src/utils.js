import Recycler from './Recycler';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getApproxSize(renderedSize, renderedNumber, totalNumber) {
  return renderedSize + (totalNumber - renderedNumber) * (renderedSize / renderedNumber);
}

export function eventTarget(se) {
  const d = document;
  return se === d.body || se === d.documentElement || !(se instanceof HTMLElement) ? window : se;
}

export function checkThreshold(start, end, dist, offset, size, from) {
  return from == Recycler.START ? (start <= offset - dist) : (end >= offset + size + dist);
}

export function getRowOffset(meta, idx, from, nodes, metas) {
  if (from == Recycler.START && idx + 1 < nodes.length) {
    let nextM = metas.get(nodes[idx + 1]);
    return nextM.y - meta.h;
  }
  else if (from == Recycler.END && idx > 0) {
    let prevM = metas.get(nodes[idx - 1]);
    return prevM.y + prevM.h;
  }
  return meta.y;
}

export function getColumnOffset(meta, idx, from, nodes, metas) {
  if (from == Recycler.START && idx + 1 < nodes.length) {
    let nextM = metas.get(nodes[idx + 1]);
    return nextM.x - meta.w;
  }
  else if (from == Recycler.END && idx > 0) {
    let prevM = metas.get(nodes[idx - 1]);
    return prevM.x + prevM.w;
  }
  return meta.x;
}

export function shouldRecycleRow(node, meta, offset, size) {
  return meta.y + meta.h < offset || meta.y > offset + size
}

export function shouldRecycleColumn(node, meta, offset, size) {
  return meta.x + meta.w < offset || meta.x > offset + size
}

export function setProps(self, props) {
  props.forEach((prop) => {
    if (self.hasOwnProperty(prop)) {
      let propVal = self[prop];
      delete self[prop];
      self[prop] = propVal;
    }
  });
}

export function vnode() {
  return { dataset: {}, style: {} }
}

export function invariant(condition, errorMsg) {
  if (!condition) {
    throw new Error(errorMsg);
  }
}

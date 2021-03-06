import {
  EMPTY,
  UNKNOWN_IDX,
  RENDER_START,
  RENDER_END,
  DEFAULT_POOL_ID,
  BY_ONE,
  MIN_BATCH_SIZE,
  NOOP,
} from './constants';
import {
  addTask,
  pushToPool,
  popFromPool,
  clamp,
  hide,
  invariant,
} from './utils';
import { forNextTick, forIdleTime, forNextAnimationFrame } from './Async';

export default class Recycler {
  constructor(container, pool, storage, meta, callbacks) {
    invariant(pool instanceof Object, 'Invalid pool type');
    invariant(storage instanceof Object, 'Invalid storage type');
    invariant(meta instanceof WeakMap, 'Invalid meta type');
    this.__container = container;
    this.__storage = storage;
    this.__meta = meta;
    this.__pool = pool;
    this.__nodes = [];
    this.__queue = [];
    this.__keyNodeMap = {};
    this.__cb = callbacks;
  }

  _refresh(set, dir) {
    let cb = this.__cb, resetSet = [], startIdx = UNKNOWN_IDX;
    set.forEach((node, idx) => {
      let key = node.dataset.key;
      if (!this.__keyNodeMap[key]) {
        resetSet.push(key);
        this.__keepNode(node);
      }
    });
    if (set === this.__nodes) {
      startIdx = (dir == RENDER_START ? this._endMeta : this._startMeta).idx;
      this.__nodes = [];
    }
    this
      .__schedule(
        dir,
        forNextTick,
        cb._isClientIncomplete,
        Math.max(MIN_BATCH_SIZE, set.length),
        true,
        startIdx,
      )
      .then(_ => {
        resetSet.forEach(key => {
          let meta = this.__meta.get(this.__keyNodeMap[key]);
          if (!meta || this._has(meta.idx)) {
            this._release(key);
          }
        });
      });
  }

  _recycle(isBuffer, recalcs) {
    let cb = this.__cb,
      batchSize = isBuffer ? 3 : MIN_BATCH_SIZE,
      isJobDone = isBuffer ? cb._isBufferIncomplete : cb._isClientIncomplete,
      waiter = isBuffer ? forIdleTime : forNextTick;
    return this
      .__schedule(RENDER_START, waiter, isJobDone, batchSize, recalcs)
      .then(_ =>
        this.__schedule(RENDER_END, waiter, isJobDone, batchSize, recalcs));
  }

  __schedule(
    dir,
    writePromise,
    isDone,
    jobSize,
    inFrame,
    startIdx = UNKNOWN_IDX,
  ) {
    let updateTask,
      readPromise = inFrame ? forNextTick : forNextAnimationFrame;
    // Initializes a task that like in this case it can be preempted,
    // that is momentarily interrupted, to wait for browser's layout and
    // then waken up to query fresh geometry data without thrashing.
    return addTask(writePromise, _ => {
      if (isDone(this._startMeta, this._endMeta, dir)) {
        return;
      }
      updateTask = this.__updateTree(dir, jobSize, startIdx);
      if (updateTask.size > 0) {
        return addTask(readPromise, _ => {
          this.__layout(updateTask);
          this.__nodes = updateTask.nodes;
          return this.__schedule(dir, writePromise, isDone, jobSize, inFrame, startIdx);
        }, false);
      }
    }, true);
  }

  __putInPool(node) {
    let dataset = node.dataset;
    if (!dataset.pool) {
      dataset.pool = DEFAULT_POOL_ID;
    }
    if (!this.__keyNodeMap[dataset.key]) {
      pushToPool(this.__pool, dataset.pool, hide(node));
    }
  }

  __updateTree(dir, increment, startIdx) {
    let node,
      meta,
      cb = this.__cb,
      nodes = this.__nodes,
      metas = this.__meta,
      size = 0,
      startMeta = this._startMeta,
      endMeta = this._endMeta;

    if (
      !(startMeta && dir == RENDER_START && startMeta.idx === 0) &&
      !(endMeta && dir == RENDER_END && endMeta.idx === cb._size() - 1)
    ) {
      // Enqueue node available for recycling.
      while (
        dir == RENDER_START &&
        (node = nodes[nodes.length - 1]) &&
        (meta = metas.get(node)) &&
        cb._shouldRecycle(meta)
      ) {
        this.__putInPool(node);
        nodes.pop();
      }
      while (
        dir == RENDER_END &&
        (node = nodes[0]) &&
        (meta = metas.get(node)) &&
        cb._shouldRecycle(meta)
      ) {
        this.__putInPool(node);
        nodes.shift();
      }
      // Dequeue node or allocate a new one.
      while (size < increment && (node = this.__getNode(dir, startIdx))) {
        dir == RENDER_START ? nodes.unshift(node) : nodes.push(node);
        this.__append(node);
        size++;
      }
    }
    return { dir, nodes, size };
  }

  __layout(updateTask) {
    let nodes = updateTask.nodes,
      dir = updateTask.dir,
      size = updateTask.size,
      metas = this.__meta,
      cb = this.__cb;
    // Read.
    for (let i = size - 1; dir == RENDER_START && i >= 0; i--) {
      cb._makeActive(nodes[i], metas.get(nodes[i]), nodes, metas, i, dir);
    }
    for (
      let i = nodes.length - size;
      dir == RENDER_END && i < nodes.length;
      i++
    ) {
      cb._makeActive(nodes[i], metas.get(nodes[i]), nodes, metas, i, dir);
    }
    // Write.
    for (let i = size - 1; dir == RENDER_START && i >= 0; i--) {
      cb._layout(nodes[i], metas.get(nodes[i]));
    }
    for (
      let i = nodes.length - size;
      dir == RENDER_END && i < nodes.length;
      i++
    ) {
      cb._layout(nodes[i], metas.get(nodes[i]));
    }
  }

  __append(node) {
    let container = this.__container;
    if (node.appendChild && node.parentNode !== container) {
      container.appendChild(node);
    }
  }

  __getNode(dir, startIdx = UNKNOWN_IDX) {
    let idx, size = this.__cb._size();
    if (this.__nodes.length == 0) {
      idx = Math.min(startIdx, size - 1);
    } else {
      idx = dir == RENDER_START
        ? this._startMeta.idx - 1
        : this._endMeta.idx + 1;
      if (idx < 0) {
        return null;
      }
    }
    return idx < size && size > 0 ? this.__getNodeByIdx(idx) : null;
  }

  __getNodeByIdx(idx) {
    let meta,
      node,
      pool,
      key = idx,
      cb = this.__cb,
      keptNodes = this.__keyNodeMap,
      size = cb._size();

    meta = cb._initMeta(this.__storage[idx] || { idx, key });

    invariant(
      meta.idx >= 0 && meta.idx < size,
      'meta should contain a valid index',
    );
    pool = cb._poolForIndex(meta.idx, meta);
    key = meta.key;
    // Assign a node from any source.
    node = keptNodes[key] ||
      popFromPool(this.__pool, pool) ||
      hide(cb._createNodeContainer());
    invariant(node.dataset && node.style, 'invalid node container');
    node = cb._updateNode(node, meta.idx, meta);
    this.__storage[meta.idx] = meta;
    this.__meta.set(node, meta);
    node.dataset.key = key;
    node.dataset.pool = pool;
    if (keptNodes[key]) {
      keptNodes[key] = node;
    }
    return node;
  }

  _has(idx) {
    return idx >= this._startMeta.idx && idx <= this._endMeta.idx;
  }

  __keepNode(node) {
    invariant(
      node.dataset.key != '',
      'Node should contain a `dataset.key` property',
    );
    this.__keyNodeMap[node.dataset.key] = node;
  }

  _keep(idx) {
    let node, cb = this.__cb, meta = this.__storage[idx];
    if (meta && (node = this.__keyNodeMap[meta.key])) {
      cb._layout(node, meta);
      return meta.key;
    }
    node = this._has(idx)
      ? this.__nodes[idx - this._startMeta.idx]
      : this.__getNodeByIdx(idx);
    this.__keepNode(node, false);
    this.__append(node, RENDER_END);
    cb._layout(node, this.__meta.get(node));
    return node.dataset.key;
  }

  _release(key) {
    let node = this.__keyNodeMap[key];
    if (!node) {
      return;
    }
    let meta = this.__meta.get(node) || EMPTY;

    delete this.__keyNodeMap[key];

    if (this.__nodes[meta.idx - this._startMeta.idx] == node) {
      this.__cb._layout(node, meta);
    } else {
      this.__putInPool(node);
    }
  }

  get _startMeta() {
    return this.__meta.get(this.__nodes[0]) || EMPTY;
  }

  get _endMeta() {
    return this.__meta.get(this.__nodes[this.__nodes.length - 1]) || EMPTY;
  }

  get _nodes() {
    return this.__nodes;
  }
}

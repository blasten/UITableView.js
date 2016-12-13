(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.ListView = factory());
}(this, (function () { 'use strict';

class DomPool {
  constructor() {
    this._pools = {};
  }

  push(poolId, obj) {
    if (!this._pools[poolId]) {
      this._pools[poolId] = [];
    }
    this._pools[poolId].push(obj);
  }

  pop(poolId) {
    if (!this._pools[poolId]) {
      return null;
    }
    return this._pools[poolId].pop() || null;
  }
}

function forIdleTime() {
  return new Promise(function (resolve) {
    let w = window;
    w.requestIdleCallback ? w.requestIdleCallback(resolve) : w.setTimeout(resolve, 16);
  });
}

function forBeforePaint() {
  return new Promise(function (resolve) {
    window.requestAnimationFrame(resolve);
  });
}

class Recycler {
  constructor() {
    this._pool = null;
    this._jobId = 0;
    this._nodes = [];
    this._isMounted = false;
    this.meta = new WeekMap();
  }

  mount() {
    var _this = this;

    return Promise.resolve().then(function () {
      return forBeforePaint();
    }).then(function () {
      _this._isMounted = true;
      _this.putNodesInPool(_this.parentElement.children);
      return _this.recycle();
    }).then(function () {});
  }

  recycle() {
    var _this2 = this;

    return Promise.resolve().then(function () {
      if (!!_this2._isMounted) {
        return Promise.resolve().then(function () {
          _this2._jobId++;
          return _this2._recycle(Recycler.START, 1, _this2._jobId);
        }).then(function () {
          return _this2._recycle(Recycler.END, 1, _this2._jobId);
        });
      }
    }).then(function () {});
  }

  _recycle(from, nextIncrement, jobId) {
    var _this5 = this;

    return Promise.resolve().then(function () {
      if (!(_this5._jobId != jobId)) {
        while (!_this5._isClientFull(from)) {
          _this5._populateClient(from, nextIncrement);
          nextIncrement = nextIncrement * 2;
        }
        if (!_this5._hasEnoughContent(from)) {
          return Promise.resolve().then(function () {
            return forIdleTime();
          }).then(function (_resp) {
            let idle = _resp;
            _this5._populateClient(from, nextIncrement);
            return _this5._recycle(from, nextIncrement * 2, jobId);
          });
        }
      }
    }).then(function () {});
  }

  putNodesInPool(nodes) {
    Array.from(nodes).forEach(node => {
      this._pool.push(node.dataset.poolId || 0, node);
    });
  }

  _shouldRecycle(node) {
    return this.shouldRecycle(node, meta.get(node));
  }

  _populateClient(from, nextIncrement) {
    const nodes = this._nodes;
    const meta = this.meta;

    for (let i = 0; from == Recycler.END && i < nodes.length - 1 && this._shouldRecycle(nodes[i]); i++) {
      this._putInPool(nodes[i]);
      this._removeFromActive(nodes[i], i);
    }
    for (let i = nodes.length - 1; from == Recycler.START && i > 0 && this._shouldRecycle(nodes[i]); i--) {
      this._putInPool(nodes[i]);
      this._removeFromActive(nodes[i], i);
    }

    let poolSize = nextIncrement;
    let node;

    while (poolSize > 0 && (node = this._popNodeFromPool(from) || this._allocateNode(from))) {
      this._pushToClient(node, from);
      poolSize--;
    }
    // read
    for (let i = 0; from == Recycler.START && i < nextIncrement; i++) {
      this.makeActive(nodes[i], meta.get(nodes[i]), i, from, nodes, meta);
    }
    for (let i = nodes.length - 1; from == Recycler.END && i >= nodes.length - nextIncrement; i--) {
      this.makeActive(nodes[i], meta.get(nodes[i]), i, from, nodes, meta);
    }
    // write
    for (let i = 0; from == Recycler.START && i < nextIncrement; i++) {
      this.layout(nodes[i], meta.get(nodes[i]), i, from);
    }
    for (let i = nodes.length - 1; from == Recycler.END && i >= nodes.length - nextIncrement; i--) {
      this.layout(nodes[i], meta.get(nodes[i]), i, from);
    }
  }

  shouldRecycle(node) {}

  layout(node, idx, meta, from) {}

  makeActive(node, idx, meta, from) {}

  initMetaForIndex(idx) {
    return null;
  }

  get size() {
    return 0;
  }

  get parentElement() {
    return null;
  }

  _pushToClient(node, from) {
    const nodes = this._nodes;
    const parentElement = this.parentElement;
    from == Recycler.START ? nodes.unshift(node) : nodes.push(node);

    if (parentElement && node.parentElement !== parentElement) {
      parentElement.appendChild(node);
    }
  }

  _putInPool(node) {
    let meta = this.meta.get(node);
    this._pool.push(meta.poolId, node);
  }

  _popNodeFromPool(from) {
    let idx, poolId;
    const nodes = this._nodes;

    if (nodes.length === 0) {
      poolId = this.poolIdForIndex(0);
    } else if (from == Recycler.START) {
      idx = this.meta.get(nodes[0]).idx - 1;
      poolId = idx >= 0 ? this.poolIdForIndex(idx) : null;
    } else {
      idx = this.meta.get(nodes[nodes.length - 1]).idx + 1;
      poolId = idx < this.size ? this.poolIdForIndex(idx) : null;
    }
    const node = this._pool.pop(poolId);
    if (node) {
      this.nodeForIndex(idx, node);
      this.meta.set(node, this.initMetaForIndex(idx, node));
    }
    return node;
  }

  _allocateNode(from) {
    let idx;
    const nodes = this._nodes;
    if (from == Recycler.START) {
      idx = this.meta.get(nodes[0]).idx;
      if (idx <= 0) {
        return null;
      }
    } else {
      idx = this.meta.get(nodes[nodes.length - 1]).idx;
      if (idx >= this.size - 1) {
        return null;
      }
    }
    const node = document.createElement('div');
    this.nodeForIndex(idx, node);
    this.meta.set(node, this.initMetaForIndex(idx, node));
    return node;
  }

  _removeFromActive(node, index) {
    this.meta.delete(node);
    this._nodes.splice(index, 1);
  }

  set pool(pool) {
    if (pool instanceof DomPool) {
      this._pool = pool;
    } else {
      throw new TypeError('Invalid pool type');
    }
  }

  get pool() {
    return this._pool;
  }

  static get START() {
    return 1;
  }

  static get END() {
    return 2;
  }
}

var styles = {
  classes: `

  `
};

class ListView extends HTMLElement {
  constructor() {
    super();
    this._props = {};
    const r = new Recycler();

    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host {
          display: block;
        }
        ${ styles.classes }
      </style>
      <div id="scrollingElement">
        <div id="parentElement">
          <slot></slot>
        </div>
      </div>`;

    this._$scrollingElement = this.shadowRoot.getElementById('scrollingElement');
    this._$parentElement = this.shadowRoot.getElementById('contentElement');
    r.pool = new DomPool();
    r.parentElement = this._$parentElement;
    r.initMetaForIndex = this._initMetaForIndex;
    r.shouldRecycle = this._shouldRecycle;
    r.layout = this._layout;
    r.makeActive = this._makeActive;
    this._recycler = r;
  }

  connectedCallback() {
    this._recycler.mount();
  }

  disconnectedCallback() {
    this._recycler.unmount();
  }

  set poolIdForRow(fn) {
    this._props['poolIdForRow'] = fn;
    this._recycler.poolIdForIndex = idx => {
      fn(idx);
    };
  }

  get poolIdForIndex() {
    return this._props['poolIdForRow'];
  }

  set domForRow(fn) {
    this._props['domForRow'] = fn;
    this._recycler.nodeForIndex = (idx, container) => {
      fn(idx, container);
    };
  }

  get domForRow() {
    return this._props['domForRow'];
  }

  set numberOfRows(size) {
    this._recycler.size = size;
  }

  get numberOfRows() {
    return this._recycler.size;
  }

  _initMetaForIndex(idx) {
    return {
      idx: 0,
      h: 0,
      y: 0
    };
  }

  _shouldRecycle(node, meta) {
    const se = this.scrollingElement();
    const clientHeight = this.clientHeight();

    return meta.y + meta.h < se.scrollTop - clientHeight || meta.y + meta.h > se.scrollTop + clientHeight * 2;
  }

  _layout(node, meta) {
    transform(node, `translateY(${ meta.y }px)`);
  }

  _makeActive(node, meta, idx, from, nodes, metas) {
    meta.h = node.offsetHeight;

    if (from == Recycler.START && idx + 1 < nodes.length) {
      let nextM = metas.get(nodes[idx + 1]);
      meta.y = nextM.y - meta.h;
    } else if (from == Recycler.END && idx > 0) {
      let prevM = metas.get(nodes[idx - 1]);
      meta.y = prevM.y + prevM.h;
    } else {
      meta.y = 0;
    }
  }
}

customElements.define('list-view', ListView);

return ListView;

})));
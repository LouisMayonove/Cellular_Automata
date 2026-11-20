// Small, fast, seedable random number generator (sfc32), so a seed always
// gives the same starting board. (numpy's generator isn't reproduced: the
// same seed gives a different board than the Python app.)

function splitmix32(state) {
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  constructor(seed = 0) {
    const init = splitmix32(seed >>> 0);
    this.a = init(); this.b = init(); this.c = init(); this.d = init();
    for (let i = 0; i < 12; i++) this.u32(); // warm up
  }

  /** Uniform 32-bit unsigned integer. */
  u32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  random() {
    return this.u32() / 4294967296;
  }

  /** Uniform integer in [lo, hi). */
  int(lo, hi) {
    return lo + Math.floor(this.random() * (hi - lo));
  }
}

/** A fresh seed for "new random seed each time". */
export function randomSeed() {
  return Math.floor(Math.random() * 2147483646);
}

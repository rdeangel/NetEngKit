/* ──────────────────────────────────────────────────────────────────────
 * eigrpMetricLib.js — EIGRP classic (32-bit) vs wide (64-bit) metric math.
 *
 * Pure, dependency-free. Loaded as a plain <script src> (global) and
 * requireable in Node for the assert harness.
 *
 *   EigrpMetric.DEFAULT_K / CLASSIC_MAX / WIDE_MAX / RIB_MAX
 *   EigrpMetric.usToTens(us)   -> number   (classic interface-delay unit)
 *   EigrpMetric.usToPs(us)     -> bigint   (wide / named-mode picoseconds)
 *   EigrpMetric.classic({ bwKbps, delayTens, reliability, load, k })
 *   EigrpMetric.wide({ bwKbps, delayPs, reliability, load, k, extAttr, ribScale })
 *   EigrpMetric.validate({ bwKbps, delayUs, reliability, load, mtu, k, extAttr })
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const DEFAULT_K = { k1: 1, k2: 0, k3: 1, k4: 0, k5: 0, k6: 0 };
  const CLASSIC_MAX = 4294967040; // 2^32 - 256
  const WIDE_MAX = 18446744073709551615n; // 2^64 - 1
  const RIB_MAX = 4294967295n;
  const WIDE_SCALE = 65536n;

  const usToTens = (us) => Math.floor(us / 10);
  const usToPs = (us) => BigInt(Math.round(us * 1e6));

  function classic({ bwKbps, delayTens, reliability = 255, load = 1, k = DEFAULT_K }) {
    const K = { ...DEFAULT_K, ...k };
    const bwScaled = Math.floor(1e7 / bwKbps);
    const t1 = K.k1 * bwScaled * 256;
    const t2 = Math.floor((K.k2 * bwScaled * 256) / (256 - load));
    const t3 = K.k3 * delayTens * 256;
    const sum256 = t1 + t2 + t3;
    const out = {
      bwScaled, delayScaled: delayTens, terms: { k1: t1, k2: t2, k3: t3 }, sum256,
      k5: { applied: false, num: null, den: null },
      composite: 0, saturated: false, unreachable: false, reason: null,
    };
    let m = sum256;
    if (K.k5 !== 0) {
      const den = reliability + K.k4;
      if (den === 0) {
        out.k5 = { applied: true, num: K.k5, den };
        out.unreachable = true;
        out.reason = 'K5_ZERO_DEN';
        return out;
      }
      out.k5 = { applied: true, num: K.k5, den };
      m = Math.floor((sum256 * K.k5) / den);
    }
    if (m >= CLASSIC_MAX) {
      out.composite = CLASSIC_MAX;
      out.saturated = true;
      out.unreachable = true;
      out.reason = 'CLASSIC_SATURATED';
    } else {
      out.composite = m;
    }
    return out;
  }

  function wide({ bwKbps, delayPs, reliability = 255, load = 1, k = DEFAULT_K, extAttr = 0, ribScale = 128 }) {
    const K = { ...DEFAULT_K, ...k };
    const throughput = (WIDE_SCALE * 10000000n) / BigInt(bwKbps);
    const latency = (delayPs * WIDE_SCALE) / 1000000n;
    const t1 = BigInt(K.k1) * throughput;
    const t2 = (BigInt(K.k2) * throughput) / BigInt(256 - load);
    const t3 = BigInt(K.k3) * latency;
    const t6 = BigInt(K.k6) * BigInt(extAttr);
    const sum = t1 + t2 + t3 + t6;
    const out = {
      throughput, latency, terms: { k1: t1, k2: t2, k3: t3, k6: t6 }, sum,
      k5: { applied: false, num: null, den: null },
      composite: 0n, saturated: false, unreachable: false, reason: null,
      ribMetric: 0n, ribCapped: false,
    };
    let m = sum;
    if (K.k5 !== 0) {
      const den = BigInt(reliability) + BigInt(K.k4);
      out.k5 = { applied: true, num: BigInt(K.k5), den };
      if (den === 0n) {
        out.unreachable = true;
        out.reason = 'K5_ZERO_DEN';
        return out;
      }
      m = (sum * BigInt(K.k5)) / den;
    }
    if (m > WIDE_MAX) {
      out.composite = WIDE_MAX;
      out.saturated = true;
      out.unreachable = true;
      out.reason = 'WIDE_SATURATED';
    } else {
      out.composite = m;
    }
    let rib = out.composite / BigInt(ribScale);
    if (rib > RIB_MAX) { rib = RIB_MAX; out.ribCapped = true; }
    out.ribMetric = rib;
    return out;
  }

  const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

  function validate({ bwKbps, delayUs, reliability, load, mtu, k, extAttr }) {
    const errs = [];
    if (!isInt(bwKbps) || bwKbps < 1 || bwKbps > 10000000000) {
      errs.push({ code: 'BW_RANGE', params: { min: 1, max: 10000000000 } });
    }
    if (typeof delayUs !== 'number' || !Number.isFinite(delayUs) || delayUs < 0 || delayUs > 167772150) {
      errs.push({ code: 'DELAY_RANGE', params: { max: 167772150 } });
    }
    const bytes = { reliability, load, ...Object.fromEntries(
      Object.entries({ ...DEFAULT_K, ...k }).map(([key, v]) => [key.toUpperCase(), v])) };
    for (const [field, v] of Object.entries(bytes)) {
      if (!isInt(v) || v < 0 || v > 255) errs.push({ code: 'BYTE_RANGE', params: { field, min: 0, max: 255 } });
    }
    if (!isInt(mtu) || mtu < 68 || mtu > 65535) errs.push({ code: 'MTU_RANGE', params: {} });
    if (!isInt(extAttr) || extAttr < 0) errs.push({ code: 'EXT_RANGE', params: {} });
    return errs;
  }

  const api = { DEFAULT_K, CLASSIC_MAX, WIDE_MAX, RIB_MAX, usToTens, usToPs, classic, wide, validate };

  root.EigrpMetric = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

const { useState, useEffect, useMemo, useRef } = React;

// ─── XML Utilities (browser-native, no lib) ──────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function sanitizeTag(key) {
  let tag = String(key).replace(/[^a-zA-Z0-9._:-]/g, '_');
  if (/^[^a-zA-Z_]/.test(tag)) tag = '_' + tag;
  return tag || 'item';
}
function jsonToXml(obj, depth, tag) {
  const pad = '  '.repeat(depth);
  const t = sanitizeTag(tag);
  if (obj === null || obj === undefined) return `${pad}<${t} xsi:nil="true"/>`;
  if (typeof obj !== 'object') return `${pad}<${t}>${escapeXml(String(obj))}</${t}>`;
  if (Array.isArray(obj)) return obj.map(item => jsonToXml(item, depth, 'item')).join('\n');
  const entries = Object.entries(obj);
  if (!entries.length) return `${pad}<${t}/>`;
  const children = entries.map(([k, v]) => {
    if (Array.isArray(v)) {
      const ip = '  '.repeat(depth + 1);
      const items = v.map(item => jsonToXml(item, depth + 2, 'item')).join('\n');
      return `${ip}<${sanitizeTag(k)}>\n${items}\n${ip}</${sanitizeTag(k)}>`;
    }
    return jsonToXml(v, depth + 1, k);
  }).join('\n');
  return `${pad}<${t}>\n${children}\n${pad}</${t}>`;
}
function serializeXmlNode(node, depth) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) { const tx = node.textContent.trim(); return tx ? `${pad}${escapeXml(tx)}` : ''; }
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  const attrs = Array.from(node.attributes).map(a => ` ${a.name}="${escapeXml(a.value)}"`).join('');
  const ch = Array.from(node.childNodes).map(c => serializeXmlNode(c, depth + 1)).filter(Boolean);
  if (!ch.length) return `${pad}<${tag}${attrs}/>`;
  if (ch.length === 1 && node.childNodes.length === 1 && node.firstChild.nodeType === 3) {
    return `${pad}<${tag}${attrs}>${escapeXml(node.textContent.trim())}</${tag}>`;
  }
  return `${pad}<${tag}${attrs}>\n${ch.join('\n')}\n${pad}</${tag}>`;
}
function prettifyXml(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr.trim(), 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent.split('\n')[0].trim());
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + serializeXmlNode(doc.documentElement, 0);
}
function xmlNodeToJson(node) {
  if (node.nodeType === 3) { const tx = node.textContent.trim(); return tx || undefined; }
  if (node.nodeType !== 1) return undefined;
  const res = {};
  for (const a of node.attributes) res[`@${a.name}`] = a.value;
  const elemCh = Array.from(node.childNodes).filter(n => n.nodeType === 1);
  const text = Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').trim();
  if (!elemCh.length) {
    const val = text || null;
    if (!Object.keys(res).length) return val;
    if (val) res['#text'] = val;
    return res;
  }
  for (const child of elemCh) {
    const name = child.tagName, val = xmlNodeToJson(child);
    if (name in res) { if (!Array.isArray(res[name])) res[name] = [res[name]]; res[name].push(val); }
    else res[name] = val;
  }
  if (text) res['#text'] = text;
  return res;
}
function xmlToJson(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr.trim(), 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent.split('\n')[0].trim());
  return { [doc.documentElement.tagName]: xmlNodeToJson(doc.documentElement) };
}

// ─── YAML Utilities (uses window.jsyaml from CDN) ────────────────────────────

function jsonToYaml(obj) {
  if (!window.jsyaml) throw new Error('yaml_lib_missing');
  return window.jsyaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true });
}
function yamlToObj(yamlStr) {
  if (!window.jsyaml) throw new Error('yaml_lib_missing');
  return window.jsyaml.load(yamlStr);
}
function prettifyYaml(yamlStr) {
  return jsonToYaml(yamlToObj(yamlStr));
}

// ─── CSV/TSV Utilities ───────────────────────────────────────────────────────

function flattenObject(obj, prefix = '') {
  const result = {};
  if (obj === null || obj === undefined) return result;

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        result[newKey] = JSON.stringify(value);
      } else {
        Object.assign(result, flattenObject(value, newKey));
      }
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

function jsonToCsv(parsed) {
  if (parsed === null || parsed === undefined) return '';
  
  let rows = [];
  if (Array.isArray(parsed)) {
    rows = parsed.map(item => {
      if (item === null || item === undefined) return {};
      if (typeof item !== 'object') return { value: item };
      return flattenObject(item);
    });
  } else if (typeof parsed === 'object') {
    rows = [flattenObject(parsed)];
  } else {
    rows = [{ value: parsed }];
  }

  if (rows.length === 0) return '';

  const keysSet = new Set();
  rows.forEach(r => {
    Object.keys(r).forEach(k => keysSet.add(k));
  });
  const headers = Array.from(keysSet);
  if (headers.length === 0) return '';

  const escapeCSVValue = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const csvRows = [];
  csvRows.push(headers.map(escapeCSVValue).join(','));
  rows.forEach(r => {
    csvRows.push(headers.map(h => escapeCSVValue(r[h])).join(','));
  });

  return csvRows.join('\n');
}

function jsonToTsv(parsed) {
  if (parsed === null || parsed === undefined) return '';
  
  let rows = [];
  if (Array.isArray(parsed)) {
    rows = parsed.map(item => {
      if (item === null || item === undefined) return {};
      if (typeof item !== 'object') return { value: item };
      return flattenObject(item);
    });
  } else if (typeof parsed === 'object') {
    rows = [flattenObject(parsed)];
  } else {
    rows = [{ value: parsed }];
  }

  if (rows.length === 0) return '';

  const keysSet = new Set();
  rows.forEach(r => {
    Object.keys(r).forEach(k => keysSet.add(k));
  });
  const headers = Array.from(keysSet);
  if (headers.length === 0) return '';

  const escapeTSVValue = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    str = str.replace(/\\/g, '\\\\')
             .replace(/\t/g, '\\t')
             .replace(/\n/g, '\\n')
             .replace(/\r/g, '\\r');
    return str;
  };

  const tsvRows = [];
  tsvRows.push(headers.map(escapeTSVValue).join('\t'));
  rows.forEach(r => {
    tsvRows.push(headers.map(h => escapeTSVValue(r[h])).join('\t'));
  });

  return tsvRows.join('\n');
}

function jsonToToml(obj) {
  if (obj === null || obj === undefined) return '';
  const serializeVal = (v) => {
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) {
      if (v.every(item => typeof item !== 'object')) {
        return '[' + v.map(serializeVal).join(', ') + ']';
      }
      return '';
    }
    return '';
  };
  const lines = [];
  const writeTable = (data, prefix = '') => {
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      if (typeof val !== 'object' || Array.isArray(val) && val.every(item => typeof item !== 'object')) {
        lines.push(`${key} = ${serializeVal(val)}`);
      }
    }
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(val) && val.some(item => typeof item === 'object')) {
        val.forEach(item => {
          lines.push(`\n[[${fullKey}]]`);
          writeTable(item, fullKey);
        });
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        lines.push(`\n[${fullKey}]`);
        writeTable(val, fullKey);
      }
    }
  };
  if (Array.isArray(obj)) {
    obj.forEach(item => {
      lines.push(`[[root]]`);
      writeTable(item, 'root');
      lines.push('');
    });
  } else if (typeof obj === 'object') {
    writeTable(obj);
  } else {
    lines.push(`value = ${serializeVal(obj)}`);
  }
  return lines.join('\n').trim();
}

function tomlToJson(tomlText) {
  if (!tomlText.trim()) return '';
  const lines = tomlText.split(/\r?\n/);
  const root = {};
  let currentContext = root;
  const getOrSetPath = (obj, pathParts, isArrayOfTables = false) => {
    let curr = obj;
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i].trim();
      const isLast = i === pathParts.length - 1;
      if (isLast) {
        if (isArrayOfTables) {
          if (!curr[part]) curr[part] = [];
          const newObj = {};
          curr[part].push(newObj);
          curr = newObj;
        } else {
          if (!curr[part]) curr[part] = {};
          curr = curr[part];
        }
      } else {
        if (!curr[part]) {
          curr[part] = {};
        } else if (Array.isArray(curr[part])) {
          curr = curr[part][curr[part].length - 1];
        } else {
          curr = curr[part];
        }
      }
    }
    return curr;
  };
  const parseVal = (str) => {
    str = str.trim();
    if (str.startsWith('"') && str.endsWith('"')) {
      try { return JSON.parse(str); } catch { return str.slice(1, -1); }
    }
    if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'inf' || str === '+inf') return Infinity;
    if (str === '-inf') return -Infinity;
    if (str === 'nan' || str === '+nan' || str === '-nan') return NaN;
    if (str.startsWith('[') && str.endsWith(']')) {
      const inner = str.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map(parseVal);
    }
    if (!isNaN(str) && str !== '') return Number(str);
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      try { return new Date(str).toISOString(); } catch { return str; }
    }
    return str;
  };
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const pathStr = line.slice(2, -2);
      const pathParts = pathStr.split('.');
      currentContext = getOrSetPath(root, pathParts, true);
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const pathStr = line.slice(1, -1);
      const pathParts = pathStr.split('.');
      currentContext = getOrSetPath(root, pathParts, false);
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      const valStr = line.slice(eqIdx + 1).trim();
      currentContext[key] = parseVal(valStr);
    }
  }
  if (Object.keys(root).length === 1 && Array.isArray(root.root)) {
    return JSON.stringify(root.root, null, 2);
  }
  return JSON.stringify(root, null, 2);
}

function jsonToIni(obj) {
  if (obj === null || obj === undefined) return '';
  const lines = [];
  const serializeVal = (v) => {
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  const writeSection = (data, sectionName = '') => {
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      if (typeof val !== 'object') {
        lines.push(`${key} = ${serializeVal(val)}`);
      }
    }
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      if (typeof val === 'object' && !Array.isArray(val)) {
        const nextSection = sectionName ? `${sectionName}.${key}` : key;
        lines.push(`\n[${nextSection}]`);
        writeSection(val, nextSection);
      } else if (Array.isArray(val)) {
        val.forEach((item, idx) => {
          const nextSection = sectionName ? sectionName + '.' + key + '_' + idx : key + '_' + idx;
          if (typeof item === 'object') {
            lines.push(`\n[${nextSection}]`);
            writeSection(item, nextSection);
          } else {
            lines.push(`${key}[${idx}] = ${serializeVal(item)}`);
          }
        });
      }
    }
  };
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      lines.push(`[item_${idx}]`);
      writeSection(item, `item_${idx}`);
      lines.push('');
    });
  } else if (typeof obj === 'object') {
    writeSection(obj);
  } else {
    lines.push(`value = ${serializeVal(obj)}`);
  }
  return lines.join('\n').trim();
}

function iniToJson(iniText) {
  if (!iniText.trim()) return '';
  const lines = iniText.split(/\r?\n/);
  const root = {};
  let currentSection = null;
  const parseVal = (str) => {
    str = str.trim();
    if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null') return null;
    if (!isNaN(str) && str !== '') return Number(str);
    return str;
  };
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      root[currentSection] = root[currentSection] || {};
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      const val = parseVal(line.slice(eqIdx + 1));
      if (currentSection) {
        root[currentSection][key] = val;
      } else {
        root[key] = val;
      }
    }
  }
  return JSON.stringify(root, null, 2);
}

function jsonToJsonl(parsed) {
  if (parsed === null || parsed === undefined) return '';
  if (Array.isArray(parsed)) {
    return parsed.map(item => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(parsed);
}

function jsonlToJson(jsonlText) {
  if (!jsonlText.trim()) return '';
  const lines = jsonlText.split(/\r?\n/).filter(line => line.trim());
  const parsedArray = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      parsedArray.push(JSON.parse(lines[i]));
    } catch (e) {
      throw new Error(`Line ${i + 1} is invalid JSON: ${e.message}`);
    }
  }
  return JSON.stringify(parsedArray, null, 2);
}

function jsonToMarkdownTable(parsed) {
  if (parsed === null || parsed === undefined) return '';
  let rows = [];
  if (Array.isArray(parsed)) {
    rows = parsed.map(item => {
      if (item === null || item === undefined) return {};
      if (typeof item !== 'object') return { value: item };
      return flattenObject(item);
    });
  } else if (typeof parsed === 'object') {
    rows = [flattenObject(parsed)];
  } else {
    rows = [{ value: parsed }];
  }
  if (rows.length === 0) return '';
  const keysSet = new Set();
  rows.forEach(r => {
    Object.keys(r).forEach(k => keysSet.add(k));
  });
  const headers = Array.from(keysSet);
  if (headers.length === 0) return '';
  const cleanVal = (val) => {
    if (val === null || val === undefined) return '';
    return String(val).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  };
  const mdRows = [];
  mdRows.push('| ' + headers.map(cleanVal).join(' | ') + ' |');
  mdRows.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  rows.forEach(r => {
    mdRows.push('| ' + headers.map(h => cleanVal(r[h])).join(' | ') + ' |');
  });
  return mdRows.join('\n');
}

function markdownTableToJson(mdText) {
  if (!mdText.trim()) return '';
  const lines = mdText.split(/\r?\n/).map(l => l.trim()).filter(l => l && l.startsWith('|'));
  if (lines.length < 2) return '';
  const parseMdRow = (line) => {
    const parts = line.split('|').map(p => p.trim());
    if (parts[0] === '') parts.shift();
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  };
  const headers = parseMdRow(lines[0]);
  let startIndex = 1;
  if (lines[1] && lines[1].includes('-')) {
    startIndex = 2;
  }
  const jsonRows = [];
  for (let i = startIndex; i < lines.length; i++) {
    const values = parseMdRow(lines[i]);
    if (values.length === 0) continue;
    const row = {};
    headers.forEach((header, idx) => {
      let val = values[idx] !== undefined ? values[idx] : '';
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val === 'null') val = null;
      else if (val !== '' && !isNaN(val)) val = Number(val);
      row[header] = val;
    });
    jsonRows.push(row);
  }
  return JSON.stringify(jsonRows, null, 2);
}


function csvToJson(csvText) {
  if (!csvText.trim()) return '';
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return '';

  const parseLine = (line, sep = ',') => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === sep && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0], ',').map(h => h.trim());
  const jsonRows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], ',');
    const row = {};
    headers.forEach((header, idx) => {
      let val = values[idx] !== undefined ? values[idx].trim() : '';
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val === 'null') val = null;
      else if (val !== '' && !isNaN(val)) val = Number(val);
      row[header] = val;
    });
    jsonRows.push(row);
  }
  return JSON.stringify(jsonRows, null, 2);
}

function tsvToJson(tsvText) {
  if (!tsvText.trim()) return '';
  const lines = tsvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return '';

  const parseLine = (line) => {
    return line.split('\t').map(field => {
      return field.replace(/\\r/g, '\r')
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '\t')
                  .replace(/\\\\/g, '\\');
    });
  };

  const headers = parseLine(lines[0]).map(h => h.trim());
  const jsonRows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      let val = values[idx] !== undefined ? values[idx].trim() : '';
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val === 'null') val = null;
      else if (val !== '' && !isNaN(val)) val = Number(val);
      row[header] = val;
    });
    jsonRows.push(row);
  }
  return JSON.stringify(jsonRows, null, 2);
}



// ─── JSONPath Evaluator (basic, no lib needed) ───────────────────────────────

function parseJsonPath(path) {
  const segs = [];
  let i = 1; // skip leading $
  while (i < path.length) {
    if (path[i] === '.') {
      if (path[i + 1] === '.') {
        segs.push({ type: 'recurse' });
        i += 2;
        const m = path.slice(i).match(/^([a-zA-Z_$*][a-zA-Z0-9_$]*)/);
        if (m) { segs.push({ type: 'key', val: m[1] }); i += m[1].length; }
      } else {
        i++;
        const m = path.slice(i).match(/^([a-zA-Z_$*][a-zA-Z0-9_$]*)/);
        if (m) { segs.push({ type: m[1] === '*' ? 'wild' : 'key', val: m[1] }); i += m[1].length; }
      }
    } else if (path[i] === '[') {
      const close = path.indexOf(']', i);
      const content = path.slice(i + 1, close).trim();
      i = close + 1;
      if (content === '*') segs.push({ type: 'wild' });
      else if (/^\d+$/.test(content)) segs.push({ type: 'idx', val: parseInt(content) });
      else segs.push({ type: 'key', val: content.replace(/^['"]|['"]$/g, '') });
    } else { i++; }
  }
  return segs;
}
function applySegs(node, segs, results) {
  if (!segs.length) { results.push(node); return; }
  const [seg, ...rest] = segs;
  if (seg.type === 'key') {
    if (node && typeof node === 'object' && !Array.isArray(node) && seg.val in node)
      applySegs(node[seg.val], rest, results);
  } else if (seg.type === 'idx') {
    if (Array.isArray(node) && node[seg.val] !== undefined)
      applySegs(node[seg.val], rest, results);
  } else if (seg.type === 'wild') {
    if (Array.isArray(node)) node.forEach(item => applySegs(item, rest, results));
    else if (node && typeof node === 'object') Object.values(node).forEach(v => applySegs(v, rest, results));
  } else if (seg.type === 'recurse') {
    applySegs(node, rest, results);
    if (Array.isArray(node)) node.forEach(item => applySegs(item, segs, results));
    else if (node && typeof node === 'object') Object.values(node).forEach(v => applySegs(v, segs, results));
  }
}
function evalJsonPath(data, path) {
  if (!path.trim().startsWith('$')) throw new Error("Path must start with '$'");
  const segs = parseJsonPath(path.trim());
  const results = [];
  applySegs(data, segs, results);
  return results;
}

// ─── JSON Diff ───────────────────────────────────────────────────────────────

function diffObjects(a, b, path = '$') {
  const changes = [];
  if (typeof a !== typeof b || (Array.isArray(a) !== Array.isArray(b))) {
    changes.push({ path, type: 'changed', from: a, to: b });
    return changes;
  }
  if (Array.isArray(a)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (i >= a.length) changes.push({ path: `${path}[${i}]`, type: 'added', value: b[i] });
      else if (i >= b.length) changes.push({ path: `${path}[${i}]`, type: 'removed', value: a[i] });
      else changes.push(...diffObjects(a[i], b[i], `${path}[${i}]`));
    }
    return changes;
  }
  if (a !== null && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const kp = `${path}.${k}`;
      if (!(k in a)) changes.push({ path: kp, type: 'added', value: b[k] });
      else if (!(k in b)) changes.push({ path: kp, type: 'removed', value: a[k] });
      else changes.push(...diffObjects(a[k], b[k], kp));
    }
    return changes;
  }
  if (a !== b) changes.push({ path, type: 'changed', from: a, to: b });
  return changes;
}

// ─── Syntax Highlighting ─────────────────────────────────────────────────────

function hlJson(json) {
  if (!json) return '';
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
    let cls = 'json-number';
    if (/^"/.test(m)) cls = /:$/.test(m) ? 'json-key' : 'json-string';
    else if (/true|false/.test(m)) cls = 'json-boolean';
    else if (/null/.test(m)) cls = 'json-null';
    return `<span class="${cls}">${m}</span>`;
  });
}
function hlXml(xml) {
  if (!xml) return '';
  return xml
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(&lt;\/?)([\w:.-]+)/g, (_, b, t) => `${b}<span class="json-key">${t}</span>`)
    .replace(/(\s[\w:.-]+=)(&quot;[^&]*&quot;)/g, (_, a, v) => `<span class="json-null">${a}</span><span class="json-string">${v}</span>`)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="json-boolean">$1</span>');
}
function hlYaml(yaml) {
  if (!yaml) return '';
  const esc = yaml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split('\n').map(line => {
    if (/^\s*#/.test(line)) return `<span class="json-boolean">${line}</span>`;
    const m = line.match(/^(\s*)([\w.-]+)(\s*:)(.*)$/);
    if (m) {
      const val = m[4].trim();
      let valHtml = m[4];
      if (/^["']/.test(val)) valHtml = ` <span class="json-string">${m[4].trim()}</span>`;
      else if (/^(true|false|yes|no|on|off)$/i.test(val)) valHtml = ` <span class="json-boolean">${m[4].trim()}</span>`;
      else if (/^-?\d/.test(val)) valHtml = ` <span class="json-number">${m[4].trim()}</span>`;
      else if (val) valHtml = ` <span class="json-string">${m[4].trim()}</span>`;
      return `${m[1]}<span class="json-key">${m[2]}</span>${m[3]}${valHtml}`;
    }
    return line;
  }).join('\n');
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const PRE = {
  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  padding: 14, fontFamily: 'var(--mono)', fontSize: 12, overflow: 'auto', maxHeight: 400,
  lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

function sortObj(obj) {
  if (Array.isArray(obj)) return obj.map(sortObj);
  if (obj !== null && typeof obj === 'object') {
    const s = {};
    Object.keys(obj).sort().forEach(k => s[k] = sortObj(obj[k]));
    return s;
  }
  return obj;
}

// ─── JSON Tab ────────────────────────────────────────────────────────────────

const JSON_PRESETS = [
  { label: 'Simple Object', value: '{"name":"John","age":30,"active":true}' },
  { label: 'Nested / Server', value: '{"server":{"hostname":"web-01","ip":"10.0.0.1","ports":[80,443]},"status":"running","uptime":86400}' },
  { label: 'Array of Objects', value: '[{"id":1,"protocol":"TCP","port":22},{"id":2,"protocol":"UDP","port":53},{"id":3,"protocol":"TCP","port":443}]' },
  { label: 'API Response', value: '{"status":200,"message":"OK","data":{"users":[{"id":1,"name":"Alice","role":"admin"},{"id":2,"name":"Bob","role":"user"}],"total":2,"page":1},"timestamp":"2024-01-15T10:30:00Z"}' },
  { label: 'Network Config', value: '{"interfaces":[{"name":"eth0","ipv4":"192.168.1.1/24","gateway":"192.168.1.254","dns":["8.8.8.8","8.8.4.4"]},{"name":"eth1","ipv4":"10.0.0.1/24","gateway":"10.0.0.254"}],"routes":[{"dest":"0.0.0.0/0","via":"192.168.1.254"}]}' },
  { label: 'FRR BGP Neighbors', value: '{"vrfName":"default","routerId":"10.0.0.1","as":65001,"neighbors":{"10.0.0.2":{"remoteAs":65002,"state":"Established","uptime":"1d02h33m","prefixReceivedCount":128,"prefixSentCount":14},"10.0.0.3":{"remoteAs":65003,"state":"Active","uptime":"never","prefixReceivedCount":0,"prefixSentCount":0}}}' },
  { label: 'RESTCONF Interface', value: '{"ietf-interfaces:interface":{"name":"GigabitEthernet0/0/0","description":"WAN Uplink","type":"iana-if-type:ethernetCsmacd","enabled":true,"ietf-ip:ipv4":{"address":[{"ip":"203.0.113.1","prefix-length":30}]}}}' },
  { label: 'OpenConfig Interface', value: '{"openconfig-interfaces:interfaces":{"interface":[{"name":"eth0","config":{"name":"eth0","type":"iana-if-type:ethernetCsmacd","enabled":true},"subinterfaces":{"subinterface":[{"index":0,"openconfig-if-ip:ipv4":{"addresses":{"address":[{"ip":"192.0.2.1","config":{"ip":"192.0.2.1","prefix-length":24}}]}}}]}}]}}' },
  { label: 'Ansible Inventory', value: '{"all":{"hosts":{"web01":{"ansible_host":"10.0.1.10","ansible_user":"admin"},"web02":{"ansible_host":"10.0.1.11","ansible_user":"admin"}},"children":{"webservers":{"hosts":{"web01":{},"web02":{}}},"dbservers":{"hosts":{"db01":{"ansible_host":"10.0.2.10"}}}}}}' },
];

// ─── Multi-Format Output Card Renderer ───────────────────────────────────────

function MultiFormatOutputs({ parsed, excludeFormat, xmlRoot = 'root', t }) {
  const beautified = useMemo(() => {
    if (!parsed) return '';
    try { return JSON.stringify(parsed, null, 2); } catch { return ''; }
  }, [parsed]);

  const minified = useMemo(() => {
    if (!parsed) return '';
    try { return JSON.stringify(parsed); } catch { return ''; }
  }, [parsed]);

  const xmlOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToXml(parsed, 0, xmlRoot || 'root'); } catch { return ''; }
  }, [parsed, xmlRoot]);

  const yamlOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToYaml(parsed); } catch { return ''; }
  }, [parsed]);

  const csvOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToCsv(parsed); } catch { return ''; }
  }, [parsed]);

  const tsvOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToTsv(parsed); } catch { return ''; }
  }, [parsed]);

  const tomlOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToToml(parsed); } catch { return ''; }
  }, [parsed]);

  const iniOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToIni(parsed); } catch { return ''; }
  }, [parsed]);

  const jsonlOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToJsonl(parsed); } catch { return ''; }
  }, [parsed]);

  const markdownOut = useMemo(() => {
    if (!parsed) return '';
    try { return jsonToMarkdownTable(parsed); } catch { return ''; }
  }, [parsed]);

  const fromFmt = t('jsonfmt.tab_' + excludeFormat);

  return (
    <>
      {excludeFormat !== 'json' && beautified && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_json')}</div>
            <CopyBtn text={beautified} label="copy" id={`${excludeFormat}-to-json`} />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlJson(beautified) }} />
        </div>
      )}

      {excludeFormat !== 'json' && minified && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_json')} ({t('jsonfmt.minified_title')})</div>
            <CopyBtn text={minified} label="copy" id={`${excludeFormat}-to-json-min`} />
          </div>
          <div style={{ ...PRE, maxHeight: 120, color: 'var(--dim)', fontSize: 11 }}>{minified}</div>
        </div>
      )}

      {excludeFormat !== 'xml' && xmlOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_xml')}</div>
            <CopyBtn text={xmlOut} label="copy" id={`${excludeFormat}-to-xml`} />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlXml(xmlOut) }} />
        </div>
      )}

      {excludeFormat !== 'yaml' && yamlOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_yaml')}</div>
            <CopyBtn text={yamlOut} label="copy" id={`${excludeFormat}-to-yaml`} />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlYaml(yamlOut) }} />
        </div>
      )}

      {excludeFormat !== 'csv' && csvOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_csv')}</div>
            <CopyBtn text={csvOut} label="copy" id={`${excludeFormat}-to-csv`} />
          </div>
          <pre style={PRE}>{csvOut}</pre>
        </div>
      )}

      {excludeFormat !== 'tsv' && tsvOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_tsv')}</div>
            <CopyBtn text={tsvOut} label="copy" id={`${excludeFormat}-to-tsv`} />
          </div>
          <pre style={PRE}>{tsvOut}</pre>
        </div>
      )}

      {excludeFormat !== 'toml' && tomlOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_toml')}</div>
            <CopyBtn text={tomlOut} label="copy" id={`${excludeFormat}-to-toml`} />
          </div>
          <pre style={PRE}>{tomlOut}</pre>
        </div>
      )}

      {excludeFormat !== 'ini' && iniOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_ini')}</div>
            <CopyBtn text={iniOut} label="copy" id={`${excludeFormat}-to-ini`} />
          </div>
          <pre style={PRE}>{iniOut}</pre>
        </div>
      )}

      {excludeFormat !== 'jsonl' && jsonlOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_jsonl')}</div>
            <CopyBtn text={jsonlOut} label="copy" id={`${excludeFormat}-to-jsonl`} />
          </div>
          <pre style={PRE}>{jsonlOut}</pre>
        </div>
      )}

      {excludeFormat !== 'markdown' && markdownOut && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{fromFmt} → {t('jsonfmt.tab_markdown')}</div>
            <CopyBtn text={markdownOut} label="copy" id={`${excludeFormat}-to-markdown`} />
          </div>
          <pre style={PRE}>{markdownOut}</pre>
        </div>
      )}
    </>
  );
}

function JsonTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:json_input', '');
  const [indentSize, setIndentSize] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [xmlRoot, setXmlRoot] = useState('root');
  const [error, setError] = useState('');
  const [parsed, setParsed] = usePersistentState('jsonfmt:json_parsed', null);

  useEffect(() => {
    if (!input.trim()) { setParsed(null); setError(''); return; }
    try { setParsed(JSON.parse(input)); setError(''); }
    catch (e) { setParsed(null); setError(e.message); }
  }, [input]);

  const beautified = useMemo(() => {
    if (!parsed) return '';
    try { return JSON.stringify(sortKeys ? sortObj(parsed) : parsed, null, indentSize); } catch { return ''; }
  }, [parsed, indentSize, sortKeys]);

  const minified = useMemo(() => {
    if (!parsed) return '';
    try { return JSON.stringify(parsed); } catch { return ''; }
  }, [parsed]);



  const stats = useMemo(() => {
    if (!parsed) return null;
    let keys = 0;
    const count = (o) => { if (Array.isArray(o)) o.forEach(count); else if (o && typeof o === 'object') Object.values(o).forEach(v => { keys++; count(v); }); };
    count(parsed);
    let depth = 0;
    const check = (o, l) => { if (typeof o !== 'object' || !o) return; depth = Math.max(depth, l); Object.values(o).forEach(v => check(v, l + 1)); };
    check(parsed, 1);
    return { type: Array.isArray(parsed) ? t('jsonfmt.type_array') : typeof parsed === 'object' ? t('jsonfmt.type_object') : typeof parsed, keys, depth, size: new Blob([input]).size, lines: input.split('\n').length };
  }, [parsed, input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {JSON_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_json')}</div>
        <textarea className="input" rows={10} placeholder={t('jsonfmt.input_placeholder')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="label" style={{ margin: 0 }}>{t('jsonfmt.indent_label')}</label>
            <select className="input" value={indentSize} onChange={e => setIndentSize(Number(e.target.value))} style={{ width: 70 }}>
              <option value={2}>2 {t('jsonfmt.spaces')}</option>
              <option value={3}>3 {t('jsonfmt.spaces')}</option>
              <option value={4}>4 {t('jsonfmt.spaces')}</option>
              <option value={8}>8 {t('jsonfmt.spaces')}</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
            <input type="checkbox" checked={sortKeys} onChange={e => setSortKeys(e.target.checked)} />
            {t('jsonfmt.sort_keys')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="label" style={{ margin: 0, fontSize: 12 }}>{t('jsonfmt.xml_root_label')}</label>
            <input className="input" type="text" value={xmlRoot} onChange={e => setXmlRoot(e.target.value)}
              placeholder={t('jsonfmt.xml_root_placeholder')} style={{ width: 90, fontSize: 12 }} />
          </div>
        </div>
        <Err msg={error} />
      </div>

      {stats && !error && (
        <div className="fadein" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {[
            { label: t('jsonfmt.stat_type'), value: stats.type, color: 'var(--cyan)' },
            { label: t('jsonfmt.stat_keys'), value: stats.keys, color: 'var(--yellow)' },
            { label: t('jsonfmt.stat_depth'), value: stats.depth, color: 'var(--green)' },
            { label: t('jsonfmt.stat_size'), value: stats.size < 1024 ? `${stats.size} ${t('common.unit_bytes')}` : `${(stats.size / 1024).toFixed(1)} ${t('common.unit_kb')}`, color: 'var(--purple)' },
            { label: t('jsonfmt.stat_lines'), value: stats.lines, color: 'var(--muted)' },
          ].map(s => (
            <div key={s.label} className="card" style={{ margin: 0, textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: 'var(--mono)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {beautified && !error && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('jsonfmt.beautified_title')}</div>
            <CopyBtn text={beautified} label="copy" id="json-beautified" />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlJson(beautified) }} />
        </div>
      )}

      {minified && !error && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('jsonfmt.minified_title')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--dim)' }}>{t('jsonfmt.size_reduction')}: {input.length} → {minified.length} ({((1 - minified.length / input.length) * 100).toFixed(1)}%)</span>
              <CopyBtn text={minified} label="copy" id="json-minified" />
            </div>
          </div>
          <div style={{ ...PRE, maxHeight: 120, color: 'var(--dim)', fontSize: 11 }}>{minified}</div>
        </div>
      )}

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="json" xmlRoot={xmlRoot} t={t} />
      )}
    </>
  );
}

// ─── XML Tab ─────────────────────────────────────────────────────────────────

const XML_PRESETS = [
  { label: 'NETCONF Interface', value: `<interface xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"><name>GigabitEthernet0/0/0</name><description>WAN Uplink</description><enabled>true</enabled><ipv4 xmlns="urn:ietf:params:xml:ns:yang:ietf-ip"><address><ip>203.0.113.1</ip><prefix-length>30</prefix-length></address></ipv4></interface>` },
  { label: 'NETCONF Static Route', value: `<routing xmlns="urn:ietf:params:xml:ns:yang:ietf-routing"><ribs><rib><name>ipv4-master</name><routes><route><destination-prefix>0.0.0.0/0</destination-prefix><next-hop><next-hop-address>203.0.113.2</next-hop-address></next-hop></route></routes></rib></ribs></routing>` },
];

function XmlTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:xml_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { prettifyXml(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const prettified = useMemo(() => {
    if (!input.trim()) return '';
    try { return prettifyXml(input); } catch { return ''; }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try { return xmlToJson(input); } catch { return null; }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.xml_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {XML_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_xml')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_xml')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {prettified && !error && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('jsonfmt.xml_prettified_title')}</div>
            <CopyBtn text={prettified} label="copy" id="xml-pretty" />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlXml(prettified) }} />
        </div>
      )}

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="xml" t={t} />
      )}
    </>
  );
}

// ─── YAML Tab ─────────────────────────────────────────────────────────────────

const YAML_PRESETS = [
  {
    label: 'Netplan Config',
    value: `network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
    eth1:
      dhcp4: true`,
  },
  {
    label: 'Ansible Playbook',
    value: `---
- name: Configure network interfaces
  hosts: routers
  gather_facts: false
  vars:
    mgmt_vlan: 10
    mgmt_prefix: 192.168.100.0/24
  tasks:
    - name: Set loopback address
      ansible.builtin.command: >
        ip addr add 10.255.0.1/32 dev lo
      changed_when: true

    - name: Flush route cache
      ansible.builtin.command: ip route flush cache
      changed_when: true`,
  },
  {
    label: 'Router Config',
    value: `---
hostname: router-01
domain: lab.example.com
interfaces:
  - name: eth0
    description: WAN Uplink
    address: 203.0.113.1
    prefix: 30
    gateway: 203.0.113.2
  - name: eth1
    description: LAN
    address: 192.168.1.1
    prefix: 24
ntp:
  servers:
    - 0.pool.ntp.org
    - 1.pool.ntp.org
dns:
  search: lab.example.com
  nameservers:
    - 8.8.8.8
    - 8.8.4.4`,
  },
];

function YamlTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:yaml_input', '');
  const [error, setError] = useState('');
  const [yamlAvail, setYamlAvail] = useState(!!window.jsyaml);

  useEffect(() => {
    if (!window.jsyaml) {
      const check = setInterval(() => { if (window.jsyaml) { setYamlAvail(true); clearInterval(check); } }, 500);
      return () => clearInterval(check);
    }
  }, []);

  useEffect(() => {
    if (!input.trim() || !yamlAvail) { setError(''); return; }
    try { yamlToObj(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input, yamlAvail]);

  const formatted = useMemo(() => {
    if (!input.trim() || !yamlAvail) return '';
    try { return prettifyYaml(input); } catch { return ''; }
  }, [input, yamlAvail]);

  const parsed = useMemo(() => {
    if (!input.trim() || !yamlAvail) return null;
    try { return yamlToObj(input); } catch { return null; }
  }, [input, yamlAvail]);

  if (!yamlAvail) {
    return (
      <div className="card fadein">
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('jsonfmt.yaml_lib_missing')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.yaml_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {YAML_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_yaml')}</div>
        <textarea className="input" rows={14} placeholder={t('jsonfmt.input_placeholder_yaml')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {formatted && !error && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('jsonfmt.yaml_formatted_title')}</div>
            <CopyBtn text={formatted} label="copy" id="yaml-formatted" />
          </div>
          <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlYaml(formatted) }} />
        </div>
      )}

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="yaml" t={t} />
      )}
    </>
  );
}

// ─── CSV Tab ─────────────────────────────────────────────────────────────────

const CSV_PRESETS = [
  {
    label: 'ARP Table',
    value: `Protocol,Address,Age,Hardware Addr,Type,Interface
Internet,10.0.0.1,120,00:11:22:33:44:55,ARPA,GigabitEthernet0/1
Internet,10.0.0.2,-,00:11:22:33:44:56,ARPA,GigabitEthernet0/1
Internet,10.0.0.254,10,00:11:22:33:44:ff,ARPA,GigabitEthernet0/1`,
  },
  {
    label: 'Interface List',
    value: `Interface,Status,IP Address,VLAN,Speed
GigabitEthernet1/1,up,192.168.1.1,10,1Gbps
GigabitEthernet1/2,down,unassigned,20,1Gbps
Loopback0,up,10.255.0.1,N/A,10Gbps`,
  },
];

function CsvTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:csv_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { csvToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = csvToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.csv_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CSV_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_csv')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_csv')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="csv" t={t} />
      )}
    </>
  );
}

// ─── TSV Tab ─────────────────────────────────────────────────────────────────

const TSV_PRESETS = [
  {
    label: 'ARP Table',
    value: `Protocol\tAddress\tAge\tHardware Addr\tType\tInterface
Internet\t10.0.0.1\t120\t00:11:22:33:44:55\tARPA\tGigabitEthernet0/1
Internet\t10.0.0.2\t-\t00:11:22:33:44:56\tARPA\tGigabitEthernet0/1
Internet\t10.0.0.254\t10\t00:11:22:33:44:ff\tARPA\tGigabitEthernet0/1`,
  },
  {
    label: 'Interface List',
    value: `Interface\tStatus\tIP Address\tVLAN\tSpeed
GigabitEthernet1/1\tup\t192.168.1.1\t10\t1Gbps
GigabitEthernet1/2\tdown\tunassigned\t20\t1Gbps
Loopback0\tup\t10.255.0.1\tN/A\t10Gbps`,
  },
];

function TsvTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:tsv_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { tsvToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = tsvToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tsv_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TSV_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_tsv')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_tsv')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="tsv" t={t} />
      )}
    </>
  );
}

// ─── TOML Tab ────────────────────────────────────────────────────────────────

const TOML_PRESETS = [
  {
    label: 'Router Config',
    value: `hostname = "Router-01"
domain = "lab.example.com"

[bgp]
as = 65001
router_id = "10.0.0.1"

[[bgp.neighbors]]
ip = "10.0.0.2"
remote_as = 65002

[[bgp.neighbors]]
ip = "10.0.0.3"
remote_as = 65003`,
  },
  {
    label: 'Interface List',
    value: `[[interfaces]]
name = "eth0"
enabled = true
ip = "192.168.1.1"

[[interfaces]]
name = "eth1"
enabled = false
ip = "10.0.0.1"`,
  },
];

function TomlTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:toml_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { tomlToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = tomlToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.toml_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TOML_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_toml')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_toml')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="toml" t={t} />
      )}
    </>
  );
}

// ─── INI Tab ─────────────────────────────────────────────────────────────────

const INI_PRESETS = [
  {
    label: 'Ansible Config',
    value: `[defaults]
inventory = ./hosts
remote_user = admin
host_key_checking = false

[privilege_escalation]
become = true
become_method = sudo`,
  },
  {
    label: 'Interface List',
    value: `[eth0]
enabled = true
ip = "192.168.1.1"

[eth1]
enabled = false
ip = "10.0.0.1"`,
  },
];

function IniTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:ini_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { iniToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = iniToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.ini_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {INI_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_ini')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_ini')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="ini" t={t} />
      )}
    </>
  );
}

// ─── JSONL Tab ───────────────────────────────────────────────────────────────

const JSONL_PRESETS = [
  {
    label: 'Log Stream',
    value: `{"timestamp":"2026-05-24T09:00:00Z","level":"info","message":"BGP neighbor 10.0.0.2 Established"}
{"timestamp":"2026-05-24T09:01:15Z","level":"warning","message":"Interface eth1 link flap"}
{"timestamp":"2026-05-24T09:02:30Z","level":"error","message":"CPU temperature exceeded threshold"}`,
  },
  {
    label: 'Interface List',
    value: `{"name":"eth0","enabled":true,"ip":"192.168.1.1"}
{"name":"eth1","enabled":false,"ip":"10.0.0.1"}`,
  },
];

function JsonlTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:jsonl_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { jsonlToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = jsonlToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.jsonl_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {JSONL_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_jsonl')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_jsonl')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="jsonl" t={t} />
      )}
    </>
  );
}

// ─── Markdown Table Tab ──────────────────────────────────────────────────────

const MARKDOWN_PRESETS = [
  {
    label: 'ARP Table',
    value: `| Protocol | Address | Age | Hardware Addr | Type | Interface |
|---|---|---|---|---|---|
| Internet | 10.0.0.1 | 120 | 00:11:22:33:44:55 | ARPA | GigabitEthernet0/1 |
| Internet | 10.0.0.2 | - | 00:11:22:33:44:56 | ARPA | GigabitEthernet0/1 |
| Internet | 10.0.0.254 | 10 | 00:11:22:33:44:ff | ARPA | GigabitEthernet0/1 |`,
  },
  {
    label: 'Interface List',
    value: `| Interface | Status | IP Address | VLAN | Speed |
|---|---|---|---|---|
| GigabitEthernet1/1 | up | 192.168.1.1 | 10 | 1Gbps |
| GigabitEthernet1/2 | down | unassigned | 20 | 1Gbps |
| Loopback0 | up | 10.255.0.1 | N/A | 10Gbps |`,
  },
];

function MarkdownTab({ t }) {
  const [input, setInput] = usePersistentState('jsonfmt:markdown_input', '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!input.trim()) { setError(''); return; }
    try { markdownTableToJson(input); setError(''); }
    catch (e) { setError(e.message); }
  }, [input]);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      const jsonStr = markdownTableToJson(input);
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch {
      return null;
    }
  }, [input]);

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.markdown_presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MARKDOWN_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => setInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.tab_markdown')}</div>
        <textarea className="input" rows={12} placeholder={t('jsonfmt.input_placeholder_markdown')}
          value={input} onChange={e => setInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={error} />
      </div>

      {parsed && !error && (
        <MultiFormatOutputs parsed={parsed} excludeFormat="markdown" t={t} />
      )}
    </>
  );
}



// ─── JSONPath Tab ─────────────────────────────────────────────────────────────

const JSONPATH_SAMPLES = [
  {
    label: 'Interfaces',
    path: '$.interfaces[*].name',
    json: '{"interfaces":[{"name":"eth0","ip":"10.0.0.1","mask":24,"state":"up","speed":"1G"},{"name":"eth1","ip":"192.168.1.1","mask":30,"state":"up","speed":"10G"},{"name":"eth2","ip":"172.16.0.1","mask":24,"state":"down","speed":"1G"},{"name":"lo","ip":"127.0.0.1","mask":8,"state":"up","speed":null}]}',
  },
  {
    label: 'BGP Neighbors',
    path: '$..state',
    json: '{"routerId":"10.0.0.1","as":65001,"neighbors":{"10.0.0.2":{"remoteAs":65002,"state":"Established","uptime":"2d14h","prefixReceived":128,"prefixSent":14},"10.0.0.3":{"remoteAs":65003,"state":"Active","uptime":"never","prefixReceived":0,"prefixSent":0},"10.0.0.4":{"remoteAs":65004,"state":"Established","uptime":"5h33m","prefixReceived":512,"prefixSent":14}}}',
  },
  {
    label: 'Routing Table',
    path: '$.routes[*].prefix',
    json: '{"routes":[{"prefix":"0.0.0.0/0","nexthop":"10.0.0.254","metric":1,"protocol":"static","age":"10d"},{"prefix":"10.0.0.0/8","nexthop":"10.1.0.1","metric":10,"protocol":"ospf","age":"2d"},{"prefix":"192.168.0.0/16","nexthop":"10.2.0.1","metric":20,"protocol":"bgp","age":"5h"},{"prefix":"172.16.0.0/12","nexthop":"10.3.0.1","metric":15,"protocol":"ospf","age":"3d"}]}',
  },
  {
    label: 'DNS Zone',
    path: '$.records[*].name',
    json: '{"zone":"example.com","ttl":3600,"records":[{"name":"@","type":"A","value":"93.184.216.34","ttl":3600},{"name":"www","type":"A","value":"93.184.216.34","ttl":300},{"name":"mail","type":"MX","value":"mail.example.com","priority":10,"ttl":3600},{"name":"@","type":"NS","value":"ns1.example.com","ttl":86400},{"name":"@","type":"NS","value":"ns2.example.com","ttl":86400},{"name":"vpn","type":"A","value":"198.51.100.1","ttl":60}]}',
  },
  {
    label: 'RESTCONF Response',
    path: '$.interfaces.interface[*].name',
    json: '{"interfaces":{"interface":[{"name":"GigabitEthernet0/0","config":{"name":"GigabitEthernet0/0","type":"ethernetCsmacd","enabled":true},"state":{"oper-status":"UP","counters":{"in-octets":1048576,"out-octets":2097152}}},{"name":"GigabitEthernet0/1","config":{"name":"GigabitEthernet0/1","type":"ethernetCsmacd","enabled":false},"state":{"oper-status":"DOWN","counters":{"in-octets":0,"out-octets":0}}}]}}',
  },
];

const JSONPATH_EXPR_PICKS = [
  { path: '$.interfaces[*].name', label: 'All iface names' },
  { path: '$..ip', label: 'All IPs (recursive)' },
  { path: '$.routes[*].prefix', label: 'All prefixes' },
  { path: '$.routes[0]', label: 'First route' },
  { path: '$..state', label: 'All state values' },
];

function JsonPathTab({ t }) {
  const [jsonInput, setJsonInput] = usePersistentState('jsonfmt:jsonpath_input', '');
  const [pathExpr, setPathExpr] = usePersistentState('jsonfmt:jsonpath_path', '');
  const [parsed, setParsed] = usePersistentState('jsonfmt:jsonpath_parsed', null);
  const [parseErr, setParseErr] = useState('');
  const [results, setResults] = usePersistentState('jsonfmt:jsonpath_results', null);
  const [pathErr, setPathErr] = useState('');

  useEffect(() => {
    if (!jsonInput.trim()) { setParsed(null); setParseErr(''); return; }
    try { setParsed(JSON.parse(jsonInput)); setParseErr(''); }
    catch (e) { setParsed(null); setParseErr(e.message); }
  }, [jsonInput]);

  useEffect(() => {
    if (!parsed || !pathExpr.trim()) { setResults(null); setPathErr(''); return; }
    try { setResults(evalJsonPath(parsed, pathExpr)); setPathErr(''); }
    catch (e) { setResults(null); setPathErr(e.message); }
  }, [parsed, pathExpr]);

  const resultJson = results ? JSON.stringify(results.length === 1 ? results[0] : results, null, 2) : '';

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.jsonpath_samples_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {JSONPATH_SAMPLES.map(s => (
            <button key={s.label} className="btn btn-ghost btn-sm"
              onClick={() => { setJsonInput(s.json); setPathExpr(s.path); }}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.jsonpath_json_title')}</div>
        <textarea className="input" rows={10} placeholder={t('jsonfmt.input_placeholder')}
          value={jsonInput} onChange={e => setJsonInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
        <Err msg={parseErr} />
      </div>

      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.jsonpath_expr_label')}</div>
        <input className="input" type="text" value={pathExpr} onChange={e => setPathExpr(e.target.value)}
          placeholder={t('jsonfmt.jsonpath_expr_placeholder')} style={{ fontFamily: 'var(--mono)', fontSize: 13, width: '100%' }} />
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--dim)' }}>{t('jsonfmt.jsonpath_hint')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--dim)', alignSelf: 'center' }}>{t('jsonfmt.jsonpath_expr_picks')}:</span>
          {JSONPATH_EXPR_PICKS.map(ex => (
            <button key={ex.path} className="btn btn-ghost btn-sm"
              onClick={() => setPathExpr(ex.path)} title={ex.path}>{ex.label}</button>
          ))}
        </div>
        <Err msg={pathErr} />
      </div>

      {results !== null && !pathErr && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>
              {t('jsonfmt.jsonpath_results_title')}
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                {results.length} {results.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
            {resultJson && <CopyBtn text={resultJson} label="copy" id="jsonpath-results" />}
          </div>
          {results.length === 0
            ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('jsonfmt.jsonpath_no_match')}</div>
            : <pre style={PRE} dangerouslySetInnerHTML={{ __html: hlJson(resultJson) }} />
          }
        </div>
      )}
    </>
  );
}

// ─── Diff Tab ─────────────────────────────────────────────────────────────────

const DIFF_COLORS = { added: 'var(--green)', removed: 'var(--red, #e74c3c)', changed: 'var(--yellow)' };

const DIFF_SAMPLES = [
  {
    label: 'Interface Config Change',
    mode: 'json',
    left: '{"interface":"GigabitEthernet0/1","description":"Uplink to Core","ip":"10.0.0.1","mask":30,"speed":"1G","duplex":"full","enabled":true,"vlan":null}',
    right: '{"interface":"GigabitEthernet0/1","description":"Uplink to ISP","ip":"203.0.113.1","mask":30,"speed":"10G","duplex":"full","enabled":true,"vlan":100}',
  },
  {
    label: 'BGP Config Drift',
    mode: 'json',
    left: '{"bgp":{"as":65001,"routerId":"10.0.0.1","neighbors":[{"ip":"10.0.0.2","remoteAs":65002,"description":"Peer-A","timers":{"keepalive":60,"hold":180}},{"ip":"10.0.0.3","remoteAs":65003,"description":"Peer-B","timers":{"keepalive":60,"hold":180}}],"networks":["192.168.0.0/16","10.0.0.0/8"]}}',
    right: '{"bgp":{"as":65001,"routerId":"10.0.0.1","neighbors":[{"ip":"10.0.0.2","remoteAs":65002,"description":"Peer-A-Updated","timers":{"keepalive":30,"hold":90}},{"ip":"10.0.0.3","remoteAs":65003,"description":"Peer-B","timers":{"keepalive":60,"hold":180}},{"ip":"10.0.0.4","remoteAs":65004,"description":"Peer-C","timers":{"keepalive":60,"hold":180}}],"networks":["192.168.0.0/16","10.0.0.0/8","172.16.0.0/12"]}}'
  },
  {
    label: 'Firewall Rule Change',
    mode: 'json',
    left: '{"rules":[{"id":10,"name":"Allow-HTTP","src":"any","dst":"10.0.1.0/24","port":80,"proto":"tcp","action":"permit"},{"id":20,"name":"Allow-HTTPS","src":"any","dst":"10.0.1.0/24","port":443,"proto":"tcp","action":"permit"},{"id":30,"name":"Allow-SSH","src":"10.0.0.0/8","dst":"10.0.1.0/24","port":22,"proto":"tcp","action":"permit"},{"id":999,"name":"Deny-All","src":"any","dst":"any","port":"any","proto":"any","action":"deny"}]}',
    right: '{"rules":[{"id":10,"name":"Allow-HTTP","src":"any","dst":"10.0.1.0/24","port":80,"proto":"tcp","action":"permit"},{"id":20,"name":"Allow-HTTPS","src":"any","dst":"10.0.1.0/24","port":443,"proto":"tcp","action":"permit"},{"id":25,"name":"Allow-API","src":"10.0.0.0/8","dst":"10.0.1.0/24","port":8443,"proto":"tcp","action":"permit"},{"id":999,"name":"Deny-All","src":"any","dst":"any","port":"any","proto":"any","action":"deny"}]}',
  },
  {
    label: 'YAML — Netplan Change',
    mode: 'yaml',
    left: `---
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
    eth1:
      addresses:
        - 10.0.0.1/30
      gateway4: 10.0.0.2`,
    right: `---
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
    eth1:
      addresses:
        - 10.0.0.1/30
      gateway4: 10.0.0.2`,
  },
];

function DiffTab({ t }) {
  const [left, setLeft] = usePersistentState('jsonfmt:diff_left', '');
  const [right, setRight] = usePersistentState('jsonfmt:diff_right', '');
  const [mode, setMode] = usePersistentState('jsonfmt:diff_mode', 'json');
  const [diffs, setDiffs] = usePersistentState('jsonfmt:diff_diffs', null);
  const [error, setError] = useState('');

  const parseInput = (str) => {
    if (!str.trim()) return null;
    const t = str.trim();
    switch (mode) {
      case 'json':
        return JSON.parse(t);
      case 'xml':
        return xmlToJson(t);
      case 'yaml':
        if (!window.jsyaml) throw new Error('YAML library not loaded');
        return yamlToObj(t);
      case 'csv':
        return JSON.parse(csvToJson(t));
      case 'tsv':
        return JSON.parse(tsvToJson(t));
      case 'toml':
        return JSON.parse(tomlToJson(t));
      case 'ini':
        return JSON.parse(iniToJson(t));
      case 'jsonl':
        return JSON.parse(jsonlToJson(t));
      case 'markdown':
        return JSON.parse(markdownTableToJson(t));
      default:
        return JSON.parse(t);
    }
  };

  useEffect(() => {
    if (!left.trim() && !right.trim()) { setDiffs(null); setError(''); return; }
    try {
      const a = left.trim() ? parseInput(left) : null;
      const b = right.trim() ? parseInput(right) : null;
      if (a === null || b === null) { setDiffs(null); setError(''); return; }
      setDiffs(diffObjects(a, b));
      setError('');
    } catch (e) { setDiffs(null); setError(e.message); }
  }, [left, right, mode]);

  const counts = diffs ? {
    added: diffs.filter(d => d.type === 'added').length,
    removed: diffs.filter(d => d.type === 'removed').length,
    changed: diffs.filter(d => d.type === 'changed').length,
  } : null;

  return (
    <>
      <div className="card fadein">
        <div className="card-title">{t('jsonfmt.diff_samples_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DIFF_SAMPLES.map(s => (
            <button key={s.label} className="btn btn-ghost btn-sm"
              onClick={() => { setLeft(s.left); setRight(s.right); setMode(s.mode); }}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>{t('jsonfmt.diff_mode_label')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <select className="input" value={mode} onChange={e => setMode(e.target.value)} style={{ padding: '4px 8px', height: 'auto', minWidth: 120 }}>
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="yaml">YAML</option>
              <option value="csv">CSV</option>
              <option value="tsv">TSV</option>
              <option value="toml">TOML</option>
              <option value="ini">INI</option>
              <option value="jsonl">JSONL</option>
              <option value="markdown">Markdown Table</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>{t('jsonfmt.diff_left_title')} (A)</div>
            <textarea className="input" rows={12} placeholder={mode === 'json' ? t('jsonfmt.input_placeholder') : t('jsonfmt.input_placeholder_' + mode)}
              value={left} onChange={e => setLeft(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>{t('jsonfmt.diff_right_title')} (B)</div>
            <textarea className="input" rows={12} placeholder={mode === 'json' ? t('jsonfmt.input_placeholder') : t('jsonfmt.input_placeholder_' + mode)}
              value={right} onChange={e => setRight(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }} />
          </div>
        </div>
        <Err msg={error} />
      </div>

      {counts && !error && (
        <div className="fadein" style={{ display: 'flex', gap: 8 }}>
          {[
            { label: t('jsonfmt.diff_added'), count: counts.added, color: DIFF_COLORS.added },
            { label: t('jsonfmt.diff_removed'), count: counts.removed, color: DIFF_COLORS.removed },
            { label: t('jsonfmt.diff_changed'), count: counts.changed, color: DIFF_COLORS.changed },
          ].map(s => (
            <div key={s.label} className="card" style={{ flex: 1, margin: 0, textAlign: 'center', padding: '10px 8px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'var(--mono)' }}>{s.count}</div>
            </div>
          ))}
        </div>
      )}

      {diffs !== null && !error && (
        <div className="card fadein">
          <div className="card-title">{t('jsonfmt.diff_results_title')}</div>
          {diffs.length === 0
            ? <div style={{ color: 'var(--green)', fontSize: 13 }}>{t('jsonfmt.diff_no_diff')}</div>
            : (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {diffs.map((d, i) => (
                  <div key={i} style={{
                    padding: '5px 10px', borderRadius: 'var(--radius)',
                    background: d.type === 'added' ? 'rgba(46,204,113,0.08)' : d.type === 'removed' ? 'rgba(231,76,60,0.08)' : 'rgba(241,196,15,0.08)',
                    borderLeft: `3px solid ${DIFF_COLORS[d.type]}`,
                  }}>
                    <span style={{ color: DIFF_COLORS[d.type], fontWeight: 600, marginRight: 6 }}>
                      {d.type === 'added' ? '+' : d.type === 'removed' ? '−' : '~'}
                    </span>
                    <span style={{ color: 'var(--cyan)' }}>{d.path}</span>
                    {d.type === 'changed' && (
                      <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                        <span style={{ color: DIFF_COLORS.removed }}>{JSON.stringify(d.from)}</span>
                        <span style={{ margin: '0 6px' }}>→</span>
                        <span style={{ color: DIFF_COLORS.added }}>{JSON.stringify(d.to)}</span>
                      </span>
                    )}
                    {d.type !== 'changed' && (
                      <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{JSON.stringify(d.value)}</span>
                    )}
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function JSONFormatter({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialData?.tab ?? 'json');
  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== tab) {
      skipNavReport.current = true;
      setTab(initialData.tab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab });
  }, [tab]);

  const TABS = [
    { id: 'json',     label: t('jsonfmt.tab_json') },
    { id: 'xml',      label: t('jsonfmt.tab_xml') },
    { id: 'yaml',     label: t('jsonfmt.tab_yaml') },
    { id: 'csv',      label: t('jsonfmt.tab_csv') },
    { id: 'tsv',      label: t('jsonfmt.tab_tsv') },
    { id: 'toml',     label: t('jsonfmt.tab_toml') },
    { id: 'ini',      label: t('jsonfmt.tab_ini') },
    { id: 'jsonl',    label: t('jsonfmt.tab_jsonl') },
    { id: 'markdown', label: t('jsonfmt.tab_markdown') },
    { id: 'jsonpath', label: t('jsonfmt.tab_jsonpath') },
    { id: 'diff',     label: t('jsonfmt.tab_diff') },
  ];

  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({ tool: 'jsonfmt', tab });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, onShare]);

  return (
    <div className="tool-content">
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {TABS.map(tb => (
          <button key={tb.id} className={`btn btn-sm ${tab === tb.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(tb.id)}>{tb.label}</button>
        ))}
      </div>
      {tab === 'json'     && <JsonTab t={t} />}
      {tab === 'xml'      && <XmlTab t={t} />}
      {tab === 'yaml'     && <YamlTab t={t} />}
      {tab === 'csv'      && <CsvTab t={t} />}
      {tab === 'tsv'      && <TsvTab t={t} />}
      {tab === 'toml'     && <TomlTab t={t} />}
      {tab === 'ini'      && <IniTab t={t} />}
      {tab === 'jsonl'    && <JsonlTab t={t} />}
      {tab === 'markdown' && <MarkdownTab t={t} />}
      {tab === 'jsonpath' && <JsonPathTab t={t} />}
      {tab === 'diff'     && <DiffTab t={t} />}
    </div>
  );
}

window.FormatToolkitUtils = {
  xmlToJson,
  jsonToXml,
  prettifyXml,
  yamlToObj,
  jsonToYaml,
  prettifyYaml,
  csvToJson,
  jsonToCsv,
  tsvToJson,
  jsonToTsv,
  tomlToJson,
  jsonToToml,
  iniToJson,
  jsonToIni,
  jsonlToJson,
  jsonToJsonl,
  markdownTableToJson,
  jsonToMarkdownTable
};

window.JSONFormatter = JSONFormatter;

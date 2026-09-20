const { useState, useEffect, useCallback, useMemo } = React;

// Normalize a Subject DN from forge attribute array into a canonical string
// Builds sorted key=value pairs to be order-independent (ASN.1 vs forge ordering)
// Uses the attribute array directly to avoid comma-in-value parsing issues
const dnFromAttrs = (attrs) => {
  const pairs = attrs
    .filter(a => a.shortName || a.name)
    .map(a => `${(a.shortName || a.name).toLowerCase()}=${(a.value || '').toLowerCase()}`);
  pairs.sort();
  return pairs.join(',');
};

function CertChainBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // State management
  const [inputMode, setInputMode] = usePersistentState('certchain:inputMode', initialData?.inputMode ?? 'bundle');
  const [domain, setDomain] = usePersistentState('certchain:domain', initialData?.domain ?? '');
  const [bundleInput, setBundleInput] = usePersistentState('certchain:bundleInput', initialData?.bundleInput ?? '');
  const [leafInput, setLeafInput] = usePersistentState('certchain:leafInput', initialData?.leafInput ?? '');
  const [intermediateInput, setIntermediateInput] = usePersistentState('certchain:intermediateInput', initialData?.intermediateInput ?? '');
  const [rootInput, setRootInput] = usePersistentState('certchain:rootInput', initialData?.rootInput ?? '');
  const [forgeReady, setForgeReady] = useState(!!window.forge);
  const [err, setErr] = useState('');
  const [results, setResults] = usePersistentState('certchain:results', null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [checkRootTrust, setCheckRootTrust] = usePersistentState('certchain:checkRootTrust', false);
  const [acquiring, setAcquiring] = useState(false);
  const [shouldAutoValidate, setShouldAutoValidate] = useState(false);

  // Auto-validate after acquiring certificate
  useEffect(() => {
    if (shouldAutoValidate) {
      setShouldAutoValidate(false);
      handleValidate();
    }
  }, [shouldAutoValidate]);

  // Mozilla root store data — loaded from data/mozilla-roots.js (generated from CCADB)
  const rootStoreSubjects = typeof MOZILLA_ROOT_SUBJECTS !== 'undefined' ? MOZILLA_ROOT_SUBJECTS : null;
  const rootStoreDate = typeof MOZILLA_ROOT_DATE !== 'undefined' ? MOZILLA_ROOT_DATE : null;
  const rootStoreCount = typeof MOZILLA_ROOT_COUNT !== 'undefined' ? MOZILLA_ROOT_COUNT : 0;

  // Patch node-forge to support ECDSA certificates metadata parsing
  const patchNodeForge = () => {
    const forge = window.forge;
    if (!forge || forge.pki._patchedECDSA) return;
    
    const origCertificateFromAsn1 = forge.pki.certificateFromAsn1;
    forge.pki.certificateFromAsn1 = function(obj, computeHash) {
      const origDerToOid = forge.asn1.derToOid;
      const origRsaEncryption = forge.pki.oids.rsaEncryption;
      
      forge.asn1.derToOid = function(der) {
        const oid = origDerToOid(der);
        if (oid === '1.2.840.10045.2.1') {
          forge.pki.oids.rsaEncryption = '1.2.840.10045.2.1';
        }
        return oid;
      };

      try {
        return origCertificateFromAsn1(obj, computeHash);
      } finally {
        forge.asn1.derToOid = origDerToOid;
        forge.pki.oids.rsaEncryption = origRsaEncryption;
      }
    };

    const origPublicKeyFromAsn1 = forge.pki.publicKeyFromAsn1;
    forge.pki.publicKeyFromAsn1 = function(obj) {
      try {
        const algorithmOid = forge.asn1.derToOid(obj.value[0].value[0].value);
        if (algorithmOid !== '1.2.840.113549.1.1.1') { // not RSA
          return {
            oid: algorithmOid,
            keyType: 'ECC/Other',
            _eccPlaceholder: true
          };
        }
      } catch (_) {}

      try {
        return origPublicKeyFromAsn1(obj);
      } catch (err) {
        return {
          oid: 'unknown',
          keyType: 'ECC/Other',
          _eccPlaceholder: true
        };
      }
    };
    
    forge.pki._patchedECDSA = true;
  };

  // Load node-forge asynchronously
  useEffect(() => {
    if (window.forge) {
      patchNodeForge();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/node-forge@1.3.1/dist/forge.min.js';
    s.onload = () => {
      patchNodeForge();
      setForgeReady(true);
    };
    s.onerror = () => setErr(t('cert_chain.loading_crypto_error', 'Failed to load cryptography engine.'));
    document.head.appendChild(s);
  }, [t]);

  // Wire into share URL system
  useEffect(() => {
    const handleShareRequest = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'cert-chain',
        inputMode,
        domain,
        bundleInput,
        leafInput,
        intermediateInput,
        rootInput
      });
    };
    window.addEventListener('app:request-share', handleShareRequest);
    return () => window.removeEventListener('app:request-share', handleShareRequest);
  }, [inputMode, domain, bundleInput, leafInput, intermediateInput, rootInput, onShare]);

  // Restore state on load
  useEffect(() => {
    if (initialData) {
      if (initialData.inputMode !== undefined) setInputMode(initialData.inputMode);
      if (initialData.domain !== undefined) setDomain(initialData.domain);
      if (initialData.bundleInput !== undefined) setBundleInput(initialData.bundleInput);
      if (initialData.leafInput !== undefined) setLeafInput(initialData.leafInput);
      if (initialData.intermediateInput !== undefined) setIntermediateInput(initialData.intermediateInput);
      if (initialData.rootInput !== undefined) setRootInput(initialData.rootInput);
    }
  }, [initialData]);

  // Help match OIDs
  const getSignatureAlgorithmName = (oid) => {
    const map = {
      '1.2.840.113549.1.1.4': 'MD5-RSA',
      '1.2.840.113549.1.1.5': 'SHA1-RSA',
      '1.2.840.113549.1.1.11': 'SHA256-RSA',
      '1.2.840.113549.1.1.12': 'SHA384-RSA',
      '1.2.840.113549.1.1.13': 'SHA512-RSA',
      '1.2.840.10045.4.3.2': 'ECDSA-SHA256',
      '1.2.840.10045.4.3.3': 'ECDSA-SHA384',
      '1.2.840.10045.4.3.4': 'ECDSA-SHA512',
      '1.3.14.3.2.29': 'SHA1-RSA'
    };
    return map[oid] || oid || 'Unknown';
  };

  // Helper: check if OID is weak
  const isWeakAlgorithm = (oid) => {
    // MD5 (1.2.840.113549.1.1.4) or SHA1 (1.2.840.113549.1.1.5, 1.3.14.3.2.29)
    return ['1.2.840.113549.1.1.4', '1.2.840.113549.1.1.5', '1.3.14.3.2.29'].includes(oid);
  };

  // Helper: check wildcard domain match
  const matchDomainName = (pattern, hostname) => {
    if (!pattern || !hostname) return false;
    const pat = pattern.toLowerCase().trim();
    const host = hostname.toLowerCase().trim();
    if (pat === host) return true;
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(2);
      const hostParts = host.split('.');
      if (hostParts.length > 1) {
        const hostSuffix = hostParts.slice(1).join('.');
        return hostSuffix === suffix;
      }
    }
    return false;
  };

  // Helper: format Distinguished Name
  const formatDN = (dnObject) => {
    if (!dnObject || !dnObject.attributes) return '';
    return dnObject.attributes
      .map(a => `${a.shortName || a.name}=${a.value}`)
      .join(', ');
  };

  // Helper: get specific field from DN
  const getDNField = (dnObject, nameOrShortName) => {
    if (!dnObject || !dnObject.attributes) return '';
    const attr = dnObject.attributes.find(
      a => a.name === nameOrShortName || a.shortName === nameOrShortName
    );
    return attr ? attr.value : '';
  };

  const handleAcquireCert = async () => {
    if (acquiring || !domain.trim()) return;
    setErr('');
    setResults(null);
    setAcquiring(true);
    try {
      const target = domain.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
      const response = await fetch(`/api/get-cert-chain?domain=${encodeURIComponent(target)}`);
      if (!response.ok) {
        let errMsg = 'Failed to acquire certificate';
        try {
          const data = await response.json();
          if (data && data.error) errMsg = data.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      const data = await response.json();
      if (!data.chain || !data.chain.length) {
        throw new Error('No certificates returned');
      }
      
      const chain = data.chain;
      setBundleInput(chain.join('\n\n'));
      
      if (chain.length > 0) {
        setLeafInput(chain[0]);
      } else {
        setLeafInput('');
      }
      
      if (chain.length > 2) {
        setIntermediateInput(chain.slice(1, -1).join('\n\n'));
        setRootInput(chain[chain.length - 1]);
      } else if (chain.length === 2) {
        setIntermediateInput(chain[1]);
        setRootInput('');
      } else {
        setIntermediateInput('');
        setRootInput('');
      }
      
      setShouldAutoValidate(true);
    } catch (e) {
      setErr(t('cert_chain.acquire_error', { msg: e.message }));
    } finally {
      setAcquiring(false);
    }
  };

  // Build & Validate Certificates Chain
  const handleValidate = () => {
    setErr('');
    setResults(null);
    if (!window.forge) {
      setErr(t('cert_chain.loading_crypto', 'Loading node-forge...'));
      return;
    }

    try {
      const forge = window.forge;
      const parsedCerts = [];

      // Extract PEM strings
      const rawStrings = [];
      if (inputMode === 'bundle') {
        const matches = bundleInput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
        if (matches) {
          rawStrings.push(...matches);
        }
      } else {
        if (leafInput.trim()) rawStrings.push(leafInput);
        if (intermediateInput.trim()) {
          const matches = intermediateInput.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
          if (matches) rawStrings.push(...matches);
          else rawStrings.push(intermediateInput);
        }
        if (rootInput.trim()) rawStrings.push(rootInput);
      }

      if (rawStrings.length === 0) {
        setErr(t('cert_chain.err_no_certs'));
        return;
      }

      // Parse all certificates
      for (const pem of rawStrings) {
        try {
          const cleanPem = pem.trim();
          if (!cleanPem) continue;
          const cert = forge.pki.certificateFromPem(cleanPem);
          parsedCerts.push({ cert, pem: cleanPem });
        } catch (parseError) {
          setErr(t('cert_chain.err_parse_failed', { msg: parseError.message }));
          return;
        }
      }

      if (parsedCerts.length === 0) {
        setErr(t('cert_chain.err_no_certs'));
        return;
      }

      // Find leaf certificate
      // The leaf is either cA: false in extensions, or its subject is not issuer of any other cert in the bundle
      let leafObj = parsedCerts.find(obj => {
        const bc = obj.cert.getExtension('basicConstraints');
        return bc && bc.cA === false;
      });

      if (!leafObj) {
        // Fallback: find cert whose subject is not an issuer of any other parsed cert
        const subjectNames = parsedCerts.map(obj => formatDN(obj.cert.subject));
        leafObj = parsedCerts.find(obj => {
          const sub = formatDN(obj.cert.subject);
          const iss = formatDN(obj.cert.issuer);
          // If it's self-signed, it might be Root, skip unless it's the only one
          if (sub === iss && parsedCerts.length > 1) return false;
          return !parsedCerts.some(other => formatDN(other.cert.issuer) === sub);
        });
      }

      // Final fallback: just take the first cert
      if (!leafObj) {
        leafObj = parsedCerts[0];
      }

      // Build chain upwards from Leaf
      const chain = [leafObj];
      const maxChainLength = 20; // safety limit to prevent loops
      let current = leafObj;
      let rootFound = false;

      while (chain.length < maxChainLength) {
        const currentSubject = formatDN(current.cert.subject);
        const currentIssuer = formatDN(current.cert.issuer);

        // If self-signed, we reached root
        if (currentSubject === currentIssuer) {
          rootFound = true;
          break;
        }

        // Find parent cert whose subject matches current issuer
        const parent = parsedCerts.find(obj => {
          // make sure we don't pick current cert
          if (obj === current) return false;
          return formatDN(obj.cert.subject) === currentIssuer;
        });

        if (!parent) {
          // No parent found in the provided list
          break;
        }

        // Prevent loops
        if (chain.includes(parent)) {
          setErr(t('cert_chain.trust_path_loop'));
          return;
        }

        chain.push(parent);
        current = parent;
      }

      // Validate each certificate in the chain
      const now = new Date();
      const validationList = chain.map((obj, index) => {
        const c = obj.cert;
        const cn = getDNField(c.subject, 'commonName') || 'Unknown';
        const isRoot = formatDN(c.subject) === formatDN(c.issuer);
        const isLeaf = index === 0;
        const isIntermediate = !isLeaf && !isRoot;

        const checks = [];

        // Check 1: Validity dates
        const notBefore = c.validity.notBefore;
        const notAfter = c.validity.notAfter;
        let dateOk = false;
        let dateMsg = '';

        if (now < notBefore) {
          dateMsg = t('cert_chain.check_date_not_yet', { date: notBefore.toISOString().split('T')[0] });
        } else if (now > notAfter) {
          dateMsg = t('cert_chain.check_date_expired', { date: notAfter.toISOString().split('T')[0] });
        } else {
          dateOk = true;
          dateMsg = t('cert_chain.check_date_ok');
        }
        checks.push({ ok: dateOk, msg: dateMsg, name: 'date' });

        // Check 2: Key size
        let keyOk = true;
        let keyMsg = '';
        if (c.publicKey.n) {
          const bits = c.publicKey.n.bitLength();
          if (bits < 2048) {
            keyOk = false;
            keyMsg = t('cert_chain.check_key_weak', { bits });
          } else {
            keyMsg = t('cert_chain.check_key_ok', { bits });
          }
        } else {
          keyMsg = t('cert_chain.key_size') + ': ECC/Other';
        }
        checks.push({ ok: keyOk, msg: keyMsg, name: 'key' });

        // Check 3: Signature Algorithm
        const algoOid = c.siginfo.algorithmOid || c.signatureOid;
        const algoName = getSignatureAlgorithmName(algoOid);
        const algoOk = !isWeakAlgorithm(algoOid);
        const algoMsg = algoOk
          ? t('cert_chain.check_algo_ok', { algo: algoName })
          : t('cert_chain.check_algo_weak', { algo: algoName });
        checks.push({ ok: algoOk, msg: algoMsg, name: 'algorithm' });

        // Check 4: CA constraints for intermediates and root
        if (!isLeaf) {
          const bc = c.getExtension('basicConstraints');
          const caOk = bc && bc.cA === true;
          const caMsg = caOk
            ? t('cert_chain.check_ca_ok')
            : t('cert_chain.check_ca_fail');
          checks.push({ ok: caOk, msg: caMsg, name: 'ca' });
        }

        // Check 5: Domain Mismatch (Leaf only)
        if (isLeaf && domain.trim()) {
          const target = domain.trim();
          const sanExt = c.getExtension('subjectAltName');
          const dnsNames = [cn];
          if (sanExt && sanExt.altNames) {
            sanExt.altNames.forEach(alt => {
              if (alt.type === 2 && alt.value) dnsNames.push(alt.value);
            });
          }

          const domainOk = dnsNames.some(pattern => matchDomainName(pattern, target));
          const domainMsg = domainOk
            ? t('cert_chain.check_domain_ok', { domain: target })
            : t('cert_chain.check_domain_fail', { domain: target });

          checks.push({ ok: domainOk, msg: domainMsg, name: 'domain' });
        }

        // Check 6: Signature verification against parent
        let sigOk = false;
        let sigMsg = '';
        if (isRoot) {
          if (c.publicKey && c.publicKey._eccPlaceholder) {
            sigOk = true;
            sigMsg = t('cert_chain.check_sig_ecc_skipped');
          } else {
            try {
              // self-signed
              sigOk = c.verify(c);
              sigMsg = t('cert_chain.check_sig_root_self');
            } catch (e) {
              sigMsg = t('cert_chain.check_sig_fail');
            }
          }
        } else {
          // verify against parent (which is index + 1 in chain)
          const parentObj = chain[index + 1];
          if (parentObj) {
            if (parentObj.cert.publicKey && parentObj.cert.publicKey._eccPlaceholder) {
              sigOk = true;
              sigMsg = t('cert_chain.check_sig_ecc_skipped');
            } else {
              try {
                sigOk = parentObj.cert.verify(c);
                sigMsg = t('cert_chain.check_sig_ok');
              } catch (e) {
                sigMsg = t('cert_chain.check_sig_fail');
              }
            }
          } else {
            const isTopCert = index === chain.length - 1;
            sigOk = isTopCert;
            sigMsg = t('cert_chain.check_sig_no_parent');
          }
        }
        checks.push({ ok: sigOk, msg: sigMsg, name: 'signature' });

        return {
          cn,
          dn: formatDN(c.subject),
          subjectAttrs: c.subject.attributes,
          issuer: formatDN(c.issuer),
          notBefore: notBefore.toISOString(),
          notAfter: notAfter.toISOString(),
          keySize: c.publicKey.n ? c.publicKey.n.bitLength() : 'EC',
          sigAlgo: algoName,
          isRoot,
          isLeaf,
          isIntermediate,
          checks,
          sans: c.getExtension('subjectAltName')?.altNames?.map(a => a.value || a.ip).filter(Boolean) || [],
          basicConstraints: c.getExtension('basicConstraints')
        };
      });

      // Overall status
      const hasErrors = validationList.some(item =>
        item.checks.some(c => !c.ok && c.name !== 'key' && c.name !== 'algorithm')
      );
      const hasWarnings = validationList.some(item =>
        item.checks.some(c => !c.ok && (c.name === 'key' || c.name === 'algorithm'))
      );

      let pathSummary = '';
      if (rootFound) {
        pathSummary = t('cert_chain.trust_path_ok');
      } else {
        const lastCert = validationList[validationList.length - 1];
        pathSummary = t('cert_chain.trust_path_partial', { issuer: getDNField(chain[chain.length - 1].cert.issuer, 'commonName') || 'Unknown' });
      }

      // Root trust check (optional — separate from chain validity)
      let rootTrustResult = null;
      if (checkRootTrust) {
        if (!rootStoreSubjects) {
          rootTrustResult = { trusted: false, storeUnavailable: true };
        } else {
          const rootCert = validationList.find(c => c.isRoot);
          if (rootCert) {
            const normalizedSubject = dnFromAttrs(rootCert.subjectAttrs);
            const matchedCA = rootStoreSubjects.has(normalizedSubject);
            rootTrustResult = {
              trusted: matchedCA,
              rootCN: rootCert.cn,
              rootSubject: rootCert.dn,
              matchedCA: matchedCA ? rootCert.cn : null,
              storeCount: rootStoreCount,
              storeDate: rootStoreDate
            };
          } else {
            rootTrustResult = { trusted: false, noRoot: true };
          }
        }
      }

      setResults({
        chain: validationList,
        valid: !hasErrors,
        warnings: hasWarnings,
        pathSummary,
        rootFound,
        rootTrust: rootTrustResult
      });

    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  // Generate Sample Certificate Chain programmatically
  const loadSampleData = () => {
    setErr('');
    setSampleLoading(true);
    setTimeout(() => {
      try {
        const forge = window.forge;
        const pki = forge.pki;

        // 1. Generate Root CA
        const rootKeys = pki.rsa.generateKeyPair(2048);
        const rootCert = pki.createCertificate();
        rootCert.publicKey = rootKeys.publicKey;
        rootCert.serialNumber = '01';
        rootCert.validity.notBefore = new Date();
        rootCert.validity.notAfter = new Date();
        rootCert.validity.notAfter.setFullYear(rootCert.validity.notBefore.getFullYear() + 2); // 2 years
        const rootAttrs = [
          { name: 'commonName', value: 'NetEngKit Root CA' },
          { name: 'organizationName', value: 'NetEngKit Security Org' },
          { name: 'countryName', value: 'US' }
        ];
        rootCert.setSubject(rootAttrs);
        rootCert.setIssuer(rootAttrs);
        rootCert.setExtensions([
          { name: 'basicConstraints', cA: true, critical: true },
          { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
        ]);
        rootCert.sign(rootKeys.privateKey, forge.md.sha256.create());
        const rootPem = pki.certificateToPem(rootCert);

        // 2. Generate Intermediate CA
        const intKeys = pki.rsa.generateKeyPair(2048);
        const intCert = pki.createCertificate();
        intCert.publicKey = intKeys.publicKey;
        intCert.serialNumber = '02';
        intCert.validity.notBefore = new Date();
        intCert.validity.notAfter = new Date();
        intCert.validity.notAfter.setFullYear(intCert.validity.notBefore.getFullYear() + 1); // 1 year
        const intAttrs = [
          { name: 'commonName', value: 'NetEngKit Intermediate CA' },
          { name: 'organizationName', value: 'NetEngKit Security Org' }
        ];
        intCert.setSubject(intAttrs);
        intCert.setIssuer(rootAttrs); // Issued by Root CA
        intCert.setExtensions([
          { name: 'basicConstraints', cA: true, critical: true },
          { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
        ]);
        intCert.sign(rootKeys.privateKey, forge.md.sha256.create());
        const intPem = pki.certificateToPem(intCert);

        // 3. Generate Leaf Certificate
        const leafKeys = pki.rsa.generateKeyPair(2048);
        const leafCert = pki.createCertificate();
        leafCert.publicKey = leafKeys.publicKey;
        leafCert.serialNumber = '03';
        leafCert.validity.notBefore = new Date();
        leafCert.validity.notAfter = new Date();
        leafCert.validity.notAfter.setDate(leafCert.validity.notBefore.getDate() + 90); // 90 days
        const leafAttrs = [
          { name: 'commonName', value: 'www.netengkit.local' }
        ];
        leafCert.setSubject(leafAttrs);
        leafCert.setIssuer(intAttrs); // Issued by Intermediate CA
        leafCert.setExtensions([
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
          { name: 'subjectAltName', altNames: [
            { type: 2, value: 'www.netengkit.local' },
            { type: 2, value: 'netengkit.local' }
          ]}
        ]);
        leafCert.sign(intKeys.privateKey, forge.md.sha256.create());
        const leafPem = pki.certificateToPem(leafCert);

        // Fill inputs depending on active mode
        const bundleString = `${leafPem}\n${intPem}\n${rootPem}`;
        setBundleInput(bundleString);
        setLeafInput(leafPem);
        setIntermediateInput(intPem);
        setRootInput(rootPem);
        setDomain('www.netengkit.local');

      } catch (ex) {
        setErr('Failed to load sample: ' + ex.message);
      } finally {
        setSampleLoading(false);
      }
    }, 100);
  };

  const handleClear = () => {
    setBundleInput('');
    setLeafInput('');
    setIntermediateInput('');
    setRootInput('');
    setDomain('');
    setErr('');
    setResults(null);
  };

  return (
    <div className="fadein">
      {/* Introduction Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">{t('cert_chain.title')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={loadSampleData} disabled={!forgeReady || sampleLoading}>
              {sampleLoading ? t('common.loading') : t('cert_chain.btn_load_sample')}
            </button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={handleClear}>
              {t('common.clear')}
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: '1.5', margin: '6px 0 16px 0' }}>
          {t('cert_chain.subtitle')}
        </p>

        {/* Input Mode Selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            className={`btn btn-sm ${inputMode === 'bundle' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setInputMode('bundle')}
          >
            {t('cert_chain.tab_bundle')}
          </button>
          <button
            className={`btn btn-sm ${inputMode === 'individual' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setInputMode('individual')}
          >
            {t('cert_chain.tab_individual')}
          </button>
        </div>

        {/* Optional Domain Matcher */}
        <div className="field">
          <label className="label">{t('cert_chain.lbl_domain')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('cert_chain.lbl_domain_ph')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAcquireCert();
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary"
              onClick={handleAcquireCert}
              disabled={acquiring || !domain.trim()}
              style={{ whiteSpace: 'nowrap' }}
            >
              {acquiring ? t('cert_chain.btn_acquiring', 'Acquiring...') : t('cert_chain.btn_acquire', 'Acquire')}
            </button>
          </div>
          <div className="hint">{t('cert_chain.lbl_domain_hint')}</div>
        </div>

        {/* Root Trust Toggle */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 12px', marginBottom: 12,
          background: 'rgba(139, 92, 246, 0.06)',
          border: rootStoreSubjects ? '1px solid var(--tertiary)' : '1px solid var(--muted)',
          borderRadius: 'var(--radius)',
          opacity: rootStoreSubjects ? 1 : 0.6
        }}>
          <input
            type="checkbox"
            id="certchain-root-trust"
            checked={checkRootTrust}
            onChange={(e) => setCheckRootTrust(e.target.checked)}
            disabled={!rootStoreSubjects}
            style={{ marginTop: 2 }}
          />
          <div style={{ flex: 1 }}>
            <label htmlFor="certchain-root-trust" style={{ fontWeight: 600, fontSize: 13, cursor: rootStoreSubjects ? 'pointer' : 'not-allowed' }}>
              {t('cert_chain.check_root_trust_label', 'Check Root Trust')}
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {rootStoreSubjects
                ? t('cert_chain.check_root_trust_hint', 'Checks whether the root CA is included in the Mozilla Root Store (CCADB). This is separate from chain validity.')
                : t('cert_chain.check_root_trust_disabled', 'Root trust data not available — rebuild with internet access to enable this feature.')
              }
            </div>
            {checkRootTrust && rootStoreSubjects && (
              <div style={{ fontSize: 11, color: 'var(--secondary)', marginTop: 4 }}>
                {rootStoreDate
                  ? t('cert_chain.check_root_loaded_date', '{count} root certificates loaded (data dated {date})').replace('{count}', rootStoreCount).replace('{date}', rootStoreDate)
                  : t('cert_chain.check_root_loaded', '{count} root certificates loaded').replace('{count}', rootStoreCount)
                }
                {' '}— {t('cert_chain.check_root_source', 'source: Mozilla CCADB')}
              </div>
            )}
          </div>
        </div>

        {/* Inputs based on Mode */}
        {inputMode === 'bundle' ? (
          <div className="field">
            <label className="label">{t('cert_chain.lbl_bundle')}</label>
            <textarea
              className="input"
              style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 180 }}
              value={bundleInput}
              onChange={(e) => setBundleInput(e.target.value)}
              placeholder={t('cert_chain.lbl_bundle_ph')}
            />
            <div className="hint">{t('cert_chain.lbl_bundle_hint')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('cert_chain.lbl_leaf')}</label>
              <textarea
                className="input"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 100 }}
                value={leafInput}
                onChange={(e) => setLeafInput(e.target.value)}
                placeholder={t('cert_chain.lbl_leaf_ph')}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('cert_chain.lbl_intermediate')}</label>
              <textarea
                className="input"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 100 }}
                value={intermediateInput}
                onChange={(e) => setIntermediateInput(e.target.value)}
                placeholder={t('cert_chain.lbl_intermediate_ph')}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('cert_chain.lbl_root')}</label>
              <textarea
                className="input"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 100 }}
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder={t('cert_chain.lbl_root_ph')}
              />
            </div>
          </div>
        )}

        <Err msg={err} />

        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          onClick={handleValidate}
          disabled={!forgeReady}
        >
          {t('cert_chain.btn_validate')}
        </button>
      </div>

      {/* Results View */}
      {results && (
        <div className="two-col fadein">
          {/* Left Panel: Hierarchy Graph */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card-title">{t('cert_chain.chain_hierarchy')}</div>

            {/* Overall Path trust status */}
            <div
              style={{
                background: results.valid ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${results.valid ? 'var(--secondary)' : 'var(--error)'}`,
                borderRadius: 'var(--radius)',
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: results.valid ? 'var(--secondary)' : 'var(--error)'
              }}
            >
              {results.valid ? t('cert_chain.status_valid') : t('cert_chain.status_invalid')}
              <div style={{ fontWeight: 400, fontSize: 12, color: 'var(--text)', marginTop: 4 }}>
                {results.pathSummary}
              </div>
              {!results.rootFound && (
                <div style={{
                  fontWeight: 400,
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginTop: 6,
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: 6
                }}>
                  {t('cert_chain.trust_path_partial_hint')}
                </div>
              )}
            </div>

            {/* Root Trust Result — separate from chain validity */}
            {results.rootTrust && (
              <div style={{
                background: results.rootTrust.storeUnavailable
                  ? 'rgba(245, 158, 11, 0.08)'
                  : results.rootTrust.noRoot
                    ? 'rgba(245, 158, 11, 0.08)'
                    : results.rootTrust.trusted
                      ? 'rgba(34, 197, 94, 0.08)'
                      : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${
                  results.rootTrust.storeUnavailable
                    ? '#f59e0b'
                    : results.rootTrust.noRoot
                      ? '#f59e0b'
                      : results.rootTrust.trusted
                        ? 'var(--secondary)'
                        : 'var(--error)'
                }`,
                borderRadius: 'var(--radius)',
                padding: '12px 16px',
                fontSize: 13,
              }}>
                <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--tertiary)', marginBottom: 6 }}>
                  {t('cert_chain.root_trust_section_title', 'Root Trust Check')}
                </div>
                {results.rootTrust.storeUnavailable ? (
                  <div style={{ color: '#f59e0b', fontWeight: 600 }}>
                    {t('cert_chain.check_root_unavailable', 'Mozilla root store data unavailable — cannot check root trust')}
                  </div>
                ) : results.rootTrust.noRoot ? (
                  <div style={{ color: '#f59e0b', fontWeight: 600 }}>
                    {t('cert_chain.check_root_no_root', '\u26a0 No root certificate found in chain \u2014 cannot check root trust')}
                  </div>
                ) : results.rootTrust.trusted ? (
                  <div style={{ color: 'var(--secondary)', fontWeight: 600 }}>
                    {t('cert_chain.check_root_trusted', '\u2713 Root CA is in the Mozilla Root Store ({name})').replace('{name}', results.rootTrust.matchedCA)}
                  </div>
                ) : (
                  <div style={{ color: 'var(--error)', fontWeight: 600 }}>
                    {t('cert_chain.check_root_not_trusted', '\u2717 Root CA is NOT in the Mozilla Root Store')}
                  </div>
                )}
                {!results.rootTrust.storeUnavailable && !results.rootTrust.noRoot && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: '1.5' }}>
                    {results.rootTrust.storeDate
                      ? t('cert_chain.check_root_matched_against_date', 'Matched by Subject DN against {count} Mozilla root certificates (data dated {date})').replace('{count}', results.rootTrust.storeCount).replace('{date}', results.rootTrust.storeDate)
                      : t('cert_chain.check_root_matched_against', 'Matched by Subject DN against {count} Mozilla root certificates').replace('{count}', results.rootTrust.storeCount)
                    }
                    {results.rootTrust.rootSubject && (
                      <span style={{ fontFamily: 'var(--mono)', display: 'block', marginTop: 2, wordBreak: 'break-all' }}>
                        {results.rootTrust.rootSubject}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Info banner explaining root trust vs chain validity */}
            {results.rootTrust && (
              <div style={{
                background: 'rgba(139, 92, 246, 0.04)',
                border: '1px dashed var(--tertiary)',
                borderRadius: 'var(--radius)',
                padding: '10px 14px',
                fontSize: 11,
                color: 'var(--muted)',
                lineHeight: '1.6'
              }}>
                <strong style={{ color: 'var(--tertiary)' }}>
                  {t('cert_chain.root_trust_banner_title', 'Root Trust vs Chain Validity')}
                </strong>
                <br />
                {t('cert_chain.root_trust_banner_body', 'Chain validity confirms that each certificate in the chain is correctly signed by the next. Root trust confirms the root CA is included in the Mozilla Root Store (sourced from CCADB). A chain can be valid even if the root is not in the store, and vice versa. This does not check Apple, Microsoft, or Chrome root stores.')}
              </div>
            )}

            {/* Tree visualization */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingLeft: 8 }}>
              {results.chain.slice().reverse().map((cert, revIndex, arr) => {
                const index = arr.length - 1 - revIndex;
                const isFailed = cert.checks.some(c => !c.ok);
                return (
                  <div key={index} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                    {/* Visual Line */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20 }}>
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: isFailed ? 'var(--error)' : 'var(--secondary)',
                          border: '2px solid var(--border)',
                          zIndex: 2,
                          marginTop: 4
                        }}
                      />
                      {revIndex < arr.length - 1 && (
                        <div
                          style={{
                            width: 2,
                            flex: 1,
                            background: 'var(--border)',
                            zIndex: 1
                          }}
                        />
                      )}
                    </div>

                    {/* Content Block */}
                    <div style={{ flex: 1, paddingBottom: revIndex < arr.length - 1 ? 24 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{cert.cn}</span>
                        <span className={`badge ${cert.isLeaf ? 'badge-cyan' : cert.isIntermediate ? 'badge-purple' : 'badge-green'}`}>
                          {cert.isLeaf ? t('cert_chain.badge_leaf') : cert.isIntermediate ? t('cert_chain.badge_intermediate') : t('cert_chain.badge_root')}
                        </span>
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>
                        {cert.dn}
                      </div>

                      {/* Micro checks listing */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {cert.checks.map((check, cIdx) => (
                          <div
                            key={cIdx}
                            style={{
                              fontSize: 12,
                              color: check.ok ? 'var(--muted)' : (check.name === 'key' || check.name === 'algorithm' ? 'var(--warning)' : 'var(--error)')
                            }}
                          >
                            {check.msg}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Detailed Certificate Inspector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {results.chain.map((cert, index) => (
              <div className="card" key={index} style={{ borderLeft: `4px solid ${cert.isLeaf ? 'var(--cyan)' : cert.isIntermediate ? 'var(--tertiary)' : 'var(--secondary)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {t('cert_chain.cert_idx', { n: index + 1, cn: cert.cn })}
                  </div>
                </div>

                <div className="result-grid" style={{ fontSize: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                  <ResultItem label={t('cert_chain.subject')} value={cert.dn} />
                  <ResultItem label={t('cert_chain.issuer')} value={cert.issuer} />
                  <ResultItem label={t('cert_chain.not_before')} value={cert.notBefore.split('T')[0]} />
                  <ResultItem label={t('cert_chain.not_after')} value={cert.notAfter.split('T')[0]} />
                  <ResultItem label={t('cert_chain.sig_algo')} value={cert.sigAlgo} />
                  <ResultItem label={t('cert_chain.key_size')} value={cert.keySize + ' bits'} />
                  {cert.sans.length > 0 && (
                    <ResultItem label={t('cert_chain.sans')} value={cert.sans.join(', ')} />
                  )}
                  {cert.basicConstraints && (
                    <ResultItem
                      label={t('cert_chain.basic_constraints')}
                      value={`cA: ${cert.basicConstraints.cA ? 'true' : 'false'}${cert.basicConstraints.pathLenConstraint !== undefined ? `, pathLen: ${cert.basicConstraints.pathLenConstraint}` : ''}`}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.CertChainBuilder = CertChainBuilder;

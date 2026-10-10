'use client';
// Cofre de chaves da pessoa: guarda a chave privada (ECDH) que abre os documentos cifrados.
// O servidor só tem a versão embrulhada pela frase de segurança; desbloqueada, ela fica como
// CryptoKey não exportável neste aparelho até a pessoa trancar ou sair da conta.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, useConfirm, useToast } from '../components/ui/feedback';
import { changePassphrase, createVault, unlockVault, unwrapDocumentKey, WrongPassphraseError, type VaultRecord } from '../lib/crypto/e2e';
import { getSupabase } from '../lib/supabase/client';
import { useAuth } from './AuthContext';
import { deleteDeviceVault, getDeviceVault, saveDeviceVault } from './offline';
import { humanError } from './source';
import type { DocumentRow, TripBundle } from './types';

export type VaultStatus = 'off' | 'loading' | 'none' | 'locked' | 'unlocked';
type DialogMode = 'setup' | 'unlock' | 'change' | null;

export class VaultLockedError extends Error {
  constructor() {
    super('Cofre trancado. Desbloqueie com a sua frase de segurança para abrir documentos cifrados.');
    this.name = 'VaultLockedError';
  }
}
export class MissingKeyError extends Error {
  constructor() {
    super('Sua chave para este documento ainda não chegou. Ela é liberada quando alguém com acesso abre a viagem com o cofre desbloqueado.');
    this.name = 'MissingKeyError';
  }
}

interface VaultState {
  status: VaultStatus;
  /** chave pública desta pessoa (para se incluir ao enviar) */
  publicKey: JsonWebKey | null;
  /** abre o diálogo certo para o estado atual (criar ou desbloquear) */
  ask: () => void;
  openChange: () => void;
  lock: () => Promise<void>;
  /** chave AES do documento, desembrulhada com a minha chave privada */
  docKey: (b: TripBundle, d: DocumentRow) => Promise<CryptoKey>;
}

const Ctx = createContext<VaultState | null>(null);
export const MIN_PASSPHRASE = 10;

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const sb = getSupabase();
  const { user, ready, online } = useAuth();
  const uid = user?.id ?? null;
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [mode, setMode] = useState<DialogMode>(null);
  const cache = useRef(new Map<string, CryptoKey>());

  const load = useCallback(async () => {
    if (!sb || (ready && !uid)) return setStatus('off');
    if (!uid) return;
    cache.current.clear();
    const dev = await getDeviceVault(uid);
    setRecord(dev?.record ?? null);
    setPrivateKey(dev?.privateKey ?? null);
    setStatus(dev?.privateKey ? 'unlocked' : 'locked');
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const [k, v] = await Promise.all([
      sb.from('user_keys').select('public_key').eq('user_id', uid).maybeSingle(),
      sb.from('user_vaults').select('wrapped_private_key,wrap_iv,kdf_salt,kdf_iterations').eq('user_id', uid).maybeSingle(),
    ]);
    if (k.error || v.error) return; // mantém o que o aparelho já sabia
    if (!k.data || !v.data) {
      await deleteDeviceVault(uid);
      setRecord(null);
      setPrivateKey(null);
      return setStatus('none');
    }
    const rec: VaultRecord = { public_key: k.data.public_key, ...v.data };
    const samePair = dev && dev.record.public_key.x === rec.public_key.x && dev.record.public_key.y === rec.public_key.y;
    const pk = samePair ? dev.privateKey : null; // cofre recriado em outro aparelho: a chave daqui não serve mais
    await saveDeviceVault(uid, { privateKey: pk, record: rec });
    setRecord(rec);
    setPrivateKey(pk);
    setStatus(pk ? 'unlocked' : 'locked');
  }, [sb, uid, ready]);

  useEffect(() => {
    void load();
  }, [load, online]);

  const remember = useCallback(
    async (rec: VaultRecord, pk: CryptoKey) => {
      if (!uid) return;
      await saveDeviceVault(uid, { privateKey: pk, record: rec });
      cache.current.clear();
      setRecord(rec);
      setPrivateKey(pk);
      setStatus('unlocked');
    },
    [uid],
  );

  const lock = useCallback(async () => {
    if (!uid) return;
    cache.current.clear();
    setPrivateKey(null);
    if (record) await saveDeviceVault(uid, { privateKey: null, record });
    else await deleteDeviceVault(uid);
    setStatus(record ? 'locked' : 'none');
  }, [uid, record]);

  const docKey = useCallback(
    async (b: TripBundle, d: DocumentRow) => {
      if (!privateKey || !uid) throw new VaultLockedError();
      const hit = cache.current.get(d.id);
      if (hit) return hit;
      const row = (b.documentKeys ?? []).find((x) => x.document_id === d.id && x.user_id === uid);
      if (!row) throw new MissingKeyError();
      const key = await unwrapDocumentKey(row.wrapped_key, privateKey, d.id, uid);
      cache.current.set(d.id, key);
      return key;
    },
    [privateKey, uid],
  );

  const value = useMemo<VaultState>(
    () => ({
      status,
      publicKey: record?.public_key ?? null,
      ask: () => setMode(status === 'none' ? 'setup' : 'unlock'),
      openChange: () => setMode('change'),
      lock,
      docKey,
    }),
    [status, record, lock, docKey],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {mode && uid && sb ? (
        <VaultDialog
          mode={mode}
          record={record}
          onClose={() => setMode(null)}
          onSetup={async (pass) => {
            const { record: rec, privateKey: pk } = await createVault(pass);
            const r = await sb.rpc('create_key_vault', { p_public_key: rec.public_key, p_wrapped: rec.wrapped_private_key, p_iv: rec.wrap_iv, p_salt: rec.kdf_salt, p_iterations: rec.kdf_iterations });
            if (r.error) throw r.error;
            await remember(rec, pk);
          }}
          onUnlock={async (pass) => {
            if (!record) throw new Error('Conecte-se à internet para desbloquear pela primeira vez neste aparelho.');
            await remember(record, await unlockVault(record, pass));
          }}
          onChange={async (oldPass, newPass) => {
            if (!record) throw new Error('Cofre não carregado.');
            const next = await changePassphrase(record, oldPass, newPass);
            const r = await sb.from('user_vaults').update({ ...next, updated_at: new Date().toISOString() }).eq('user_id', uid);
            if (r.error) throw r.error;
            const rec = { ...record, ...next };
            setRecord(rec);
            await saveDeviceVault(uid, { privateKey, record: rec });
          }}
          onReset={async () => {
            const r = await sb.rpc('reset_key_vault');
            if (r.error) throw r.error;
            await deleteDeviceVault(uid);
            cache.current.clear();
            setRecord(null);
            setPrivateKey(null);
            setStatus('none');
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

export function useVault(): VaultState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault fora do VaultProvider');
  return v;
}

// ───── Diálogo ─────

function VaultDialog({ mode, record, onClose, onSetup, onUnlock, onChange, onReset }: {
  mode: Exclude<DialogMode, null>;
  record: VaultRecord | null;
  onClose: () => void;
  onSetup: (pass: string) => Promise<void>;
  onUnlock: (pass: string) => Promise<void>;
  onChange: (oldPass: string, newPass: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = mode === 'setup' ? 'Criar cofre' : mode === 'unlock' ? 'Desbloquear cofre' : 'Trocar frase de segurança';
  const newPass = mode === 'setup' ? a : b;
  const confirmPass = mode === 'setup' ? b : c;
  const needsNew = mode !== 'unlock';
  const invalid = !a || (needsNew && (newPass.length < MIN_PASSPHRASE || newPass !== confirmPass));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'setup') await onSetup(a);
      else if (mode === 'unlock') await onUnlock(a);
      else await onChange(a, b);
      toast(mode === 'setup' ? 'Cofre criado. Seus documentos agora são cifrados neste aparelho antes do envio.' : mode === 'unlock' ? 'Cofre desbloqueado neste aparelho.' : 'Frase de segurança trocada.');
      onClose();
    } catch (e2) {
      setErr(e2 instanceof WrongPassphraseError ? e2.message : humanError(e2));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    const ok = await confirm({
      title: 'Recomeçar o cofre?',
      message: 'Sem a frase, ninguém (nem a Trilha) consegue abrir seus documentos cifrados. Recomeçar cria chaves novas: os documentos que só você via ficam ilegíveis para sempre; os da turma voltam quando alguém com acesso abrir a viagem.',
      confirmLabel: 'Apagar chaves e recomeçar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onReset();
      toast('Chaves apagadas. Crie uma frase nova.');
      onClose();
    } catch (e2) {
      setErr(humanError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={title}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        {mode === 'setup' ? (
          <p style={{ margin: 0 }}>
            Os documentos são cifrados com AES-256-GCM neste aparelho antes do envio. O servidor só guarda o arquivo cifrado. A frase de segurança protege a sua chave e é pedida uma vez em cada aparelho.{' '}
            <b>Se você esquecer a frase, não tem como recuperar.</b> Guarde num gerenciador de senhas.
          </p>
        ) : mode === 'unlock' ? (
          <p style={{ margin: 0 }}>Digite sua frase de segurança para abrir os documentos cifrados neste aparelho. {!record ? 'Na primeira vez em cada aparelho, é preciso estar com internet.' : ''}</p>
        ) : null}
        <label className="field">
          {mode === 'change' ? 'Frase atual' : 'Frase de segurança'}
          <input type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={a} onChange={(e) => setA(e.target.value)} autoFocus />
        </label>
        {needsNew ? (
          <>
            {mode === 'change' ? (
              <label className="field">
                Nova frase
                <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
              </label>
            ) : null}
            <label className="field">
              Repita a {mode === 'change' ? 'nova ' : ''}frase
              <input type="password" autoComplete="new-password" value={mode === 'setup' ? b : c} onChange={(e) => (mode === 'setup' ? setB : setC)(e.target.value)} />
            </label>
            <small style={{ color: 'var(--mute)' }}>
              Mínimo de {MIN_PASSPHRASE} caracteres. Uma frase com 4 ou 5 palavras soltas é mais forte e mais fácil de lembrar.
              {newPass && newPass.length < MIN_PASSPHRASE ? ' Ainda curta.' : confirmPass && newPass !== confirmPass ? ' As frases não batem.' : ''}
            </small>
          </>
        ) : null}
        {err ? <div className="errbox">{err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {mode === 'unlock' && record ? <button type="button" className="btn btn-sm tap" onClick={forgot} disabled={busy}>Esqueci a frase</button> : <span />}
          <button type="submit" className="btn btn-primary tap" disabled={invalid || busy}>
            {busy ? 'Calculando chave…' : mode === 'setup' ? 'Criar cofre' : mode === 'unlock' ? 'Desbloquear' : 'Trocar frase'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

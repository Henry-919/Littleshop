import React, { useState } from 'react';
import { LockKeyhole, Mail, ShieldCheck, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError('');
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#d1fae5,transparent_36%),linear-gradient(135deg,#f8fafc,#ecfccb_45%,#dcfce7)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
        <section className="rounded-[2rem] bg-slate-950 text-white p-8 md:p-10 shadow-2xl border border-white/10 overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.28),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_28%)]" />
          <div className="relative z-10 space-y-8">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-400 text-slate-950">
                <Store className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-emerald-300/70">LittleShop</p>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight">门店管理系统</h1>
              </div>
            </div>

            <div className="max-w-xl space-y-4">
              <p className="text-lg text-slate-200 leading-8">
                现在支持账号登录和角色权限控制。管理员可以编辑库存、门店、分类、销售和退货信息，普通账号只读查看，避免误操作。
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <ShieldCheck className="w-4 h-4" />
                    管理员
                  </div>
                  <p className="mt-2 text-sm text-slate-300">可新增、编辑、删除和录入业务数据。</p>
                </div>
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="flex items-center gap-2 text-sky-300 font-semibold">
                    <LockKeyhole className="w-4 h-4" />
                    只读账号
                  </div>
                  <p className="mt-2 text-sm text-slate-300">可查看所有信息，但不会显示修改入口。</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] bg-white/95 backdrop-blur shadow-xl border border-white/70 p-8 md:p-10">
          <div className="space-y-2 mb-8">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-600 font-bold">Secure Access</p>
            <h2 className="text-3xl font-black text-slate-900">登录账号</h2>
            <p className="text-sm text-slate-500">使用 Supabase 账号登录。角色会在登录后自动识别。</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400" />
                邮箱
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="ui-input !h-12"
                placeholder="name@example.com"
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <LockKeyhole className="w-4 h-4 text-slate-400" />
                密码
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="ui-input !h-12"
                placeholder="请输入密码"
                required
              />
            </label>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="ui-btn-primary w-full !h-12 text-base">
              {submitting ? '登录中...' : '登录系统'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

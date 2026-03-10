import React from 'react';
import { Eye, ShieldAlert } from 'lucide-react';

export function ReadonlyNotice({
  title = '当前账号为只读模式',
  description = '你可以查看全部信息，但不能新增、编辑、删除或提交业务数据。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 flex items-start gap-3">
      <div className="mt-0.5 p-2 rounded-xl bg-white/70 border border-amber-200">
        <ShieldAlert className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-bold">
          <Eye className="w-4 h-4" />
          {title}
        </div>
        <p className="text-sm mt-1">{description}</p>
      </div>
    </div>
  );
}

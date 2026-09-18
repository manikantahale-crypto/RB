import React, { useEffect, useState } from 'react';

import { ChevronDown, ChevronUp, MessageSquare, Paperclip } from 'lucide-react';

import { RelayThreadMessage } from '../../types';

import { plainEmailPreview } from './emailBodyUtils';

import { EmailBodyView } from './EmailBodyView';



interface ThreadViewProps {

  thread: RelayThreadMessage[];

  activeMessageId?: string | null;

  onSelectMessage?: (message: RelayThreadMessage) => void;

}



export const ThreadView: React.FC<ThreadViewProps> = ({

  thread,

  activeMessageId,

  onSelectMessage,

}) => {

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());



  useEffect(() => {

    if (!thread.length) return;

    setExpandedIds(new Set());

  }, [thread]);



  if (!thread || thread.length === 0) return null;



  const toggleMessage = (msg: RelayThreadMessage) => {

    onSelectMessage?.(msg);

    setExpandedIds((prev) => {

      const next = new Set(prev);

      if (next.has(msg.id)) next.delete(msg.id);

      else next.add(msg.id);

      return next;

    });

  };



  return (

    <div className="rounded-2xl border border-purple-500/20 bg-[#130e24]/60 p-4 space-y-3">

      <div className="flex items-center gap-2">

        <MessageSquare className="w-4 h-4 text-purple-400" />

        <span className="text-xs font-bold text-slate-200 tracking-wide">

          Conversation history ({thread.length})

        </span>

        <span className="text-[10px] text-slate-500">Replies and earlier messages</span>

      </div>



      <div className="space-y-3 pt-1">

        {thread.map((msg, index) => {

          const isExpanded = expandedIds.has(msg.id);

          const isActive = activeMessageId === msg.id;

          const threadLabel = msg.isSelf ? 'Re:' : index === 0 && !msg.isSelf ? 'Earlier:' : '';



          return (

            <div

              key={msg.id || index}

              className={`rounded-xl border text-xs transition-all ${

                isActive

                  ? 'bg-purple-950/40 border-purple-400/50 ring-1 ring-purple-500/30'

                  : msg.isSelf

                    ? 'bg-purple-950/30 border-purple-500/30 ml-2'

                    : 'bg-white/5 border-white/10'

              }`}

            >

              <button

                type="button"

                onClick={() => toggleMessage(msg)}

                className="w-full text-left p-3 cursor-pointer"

              >

                <div className="flex items-center justify-between mb-1 gap-2">

                  <div className="flex items-center gap-2 min-w-0">

                    {threadLabel && (

                      <span className="text-[10px] font-bold text-purple-300 shrink-0">{threadLabel}</span>

                    )}

                    <div

                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${

                        msg.isSelf ? 'bg-purple-600 text-white' : 'bg-gradient-to-tr from-amber-500 to-orange-500 text-white'

                      }`}

                    >

                      {msg.senderName.charAt(0)}

                    </div>

                    <span className="font-semibold text-slate-200 truncate">{msg.senderName}</span>

                    {msg.isSelf ? (

                      <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-medium border border-purple-500/30 shrink-0">

                        You

                      </span>

                    ) : (

                      <span className="text-[10px] text-slate-400 truncate hidden sm:inline">{msg.senderEmail}</span>

                    )}

                  </div>

                  <div className="flex items-center gap-1 shrink-0">

                    <span className="text-[10px] text-slate-500 font-mono">{msg.timestamp}</span>

                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-purple-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}

                  </div>

                </div>

                {!isExpanded && (

                  <p className="text-slate-400 leading-relaxed line-clamp-2 text-[11px] pl-8">

                    {plainEmailPreview(msg.body, 160)}

                  </p>

                )}

              </button>



              {isExpanded && (

                <div className="px-3 pb-3 max-h-[min(70vh,48rem)] overflow-y-auto">

                  <EmailBodyView plain={msg.body} html={msg.bodyHtml} attachments={msg.attachments} />

                </div>

              )}



              {!isExpanded && msg.attachments && msg.attachments.length > 0 && (

                <div className="flex flex-wrap gap-2 px-3 pb-2 pl-11">

                  {msg.attachments.map((att) => (

                    <span key={att.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-slate-300">

                      <Paperclip className="w-3 h-3 text-purple-400" />

                      {att.name}

                    </span>

                  ))}

                </div>

              )}

            </div>

          );

        })}

      </div>

    </div>

  );

};



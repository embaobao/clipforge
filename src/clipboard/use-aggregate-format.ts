/** 聚合拼接格式 hook（TASK-6-A）：state + ref + 持久化三件套。
 *  从 use-clip-writeback 拆出，避免写回 hook 越过 500 行门禁；
 *  ref 供 copySelectedClips 等异步回调读最新值而不进 deps。 */
import { useEffect, useRef, useState } from "react";
import type { AggregateFormatOptions } from "./clipboard-domain";
import { loadAggregateFormat, persistAggregateFormat } from "./aggregate-format-storage";

export function useAggregateFormat() {
  const [format, setFormat] = useState<AggregateFormatOptions>(loadAggregateFormat);
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
    persistAggregateFormat(format);
  }, [format]);
  return { format, setFormat, formatRef };
}

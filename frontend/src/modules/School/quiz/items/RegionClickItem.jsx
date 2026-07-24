/** Region-click item: prompt + a ClickableAsset. Submits the picked region id
 *  once (submittedRef guards a double-tap before verdict arrives). */
import { useEffect, useRef, useState } from 'react';
import ClickableAsset from '../clickable/ClickableAsset.jsx';

export default function RegionClickItem({ item, onSubmit, verdict }) {
  const submittedRef = useRef(false);
  const [picked, setPicked] = useState(null);
  useEffect(() => { submittedRef.current = false; setPicked(null); }, [item.id]);
  const onPick = (regionId) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
    setPicked(regionId);
    onSubmit(regionId);
  };
  return (
    <div className="school-item school-item--region">
      <p className="school-item__prompt">{item.prompt}</p>
      <ClickableAsset asset={item.asset} value={picked} verdict={verdict}
        expected={verdict?.expected ?? null} onPick={onPick} />
    </div>
  );
}

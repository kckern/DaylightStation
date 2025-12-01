export class VoiceMemoManager {
  constructor(sessionRef) {
    this.sessionRef = sessionRef; // reference to owning FitnessSession
    this.memos = [];
    // External mutation callback (set by context) to trigger UI re-render
    this._mutationCb = null;
  }

  setMutationCallback(cb) { 
    this._mutationCb = typeof cb === 'function' ? cb : null; 
  }

  _notifyMutation() { 
    if (this._mutationCb) { 
      try { this._mutationCb(); } catch(_) {} 
    } 
  }

  addMemo(memo) {
    if (!memo) return null;
    
    const newMemo = {
      ...memo,
      memoId: memo.memoId || `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: memo.createdAt || Date.now(),
      sessionElapsedSeconds: memo.sessionElapsedSeconds ?? this._getSessionElapsedSeconds()
    };
    
    this.memos.push(newMemo);
    this._notifyMutation();
    return newMemo;
  }

  removeMemo(memoId) {
    if (!memoId) return;
    const initialLength = this.memos.length;
    this.memos = this.memos.filter(m => String(m.memoId) !== String(memoId));
    if (this.memos.length !== initialLength) {
      this._notifyMutation();
    }
  }

  replaceMemo(targetId, newMemo) {
    if (!targetId || !newMemo) return null;
    const index = this.memos.findIndex(m => String(m.memoId) === String(targetId));
    
    if (index === -1) {
      return this.addMemo(newMemo);
    }

    const updatedMemo = {
      ...this.memos[index],
      ...newMemo,
      memoId: targetId // Preserve ID
    };
    
    this.memos[index] = updatedMemo;
    this._notifyMutation();
    return updatedMemo;
  }

  getMemos() {
    return [...this.memos];
  }

  reset() {
    if (this.memos.length > 0) {
      this.memos = [];
      this._notifyMutation();
    }
  }

  _getSessionElapsedSeconds() {
    if (!this.sessionRef || !this.sessionRef.startTime) return 0;
    return Math.max(0, (Date.now() - this.sessionRef.startTime) / 1000);
  }

  get summary() {
    // Return a serializable summary of voice memos
    return [...this.memos];
  }
}

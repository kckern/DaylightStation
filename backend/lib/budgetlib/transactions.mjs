export const findBucket = (buckets, transaction) => {
    const dayTags = buckets.dayToDay.tags;
    const incomeTags = buckets.income.tags;
    //Monthly
    const monthTagDict = buckets.monthly.reduce((acc, {tags,label}) => {
        tags?.forEach(tag => {acc[tag] = label; acc[label] = label;});
        return acc;
    }, {});
    const monthTags = Object.keys(monthTagDict);

    //Short Term
    const shortTermTagDict = buckets.shortTerm.reduce((acc, {tags, label}) => {
        tags.forEach(tag => {
            acc[tag] = label;
            acc[label] = label; // Add the label itself to the dictionary
        });
        return acc;
    }, {});
    
    const shortTermTags = Object.keys(shortTermTagDict);

    const txnTags = Array.isArray(transaction.tagNames) ? transaction.tagNames : [transaction.tagNames];
    const mainTag = txnTags[0];
    const arraysOverlap = (a, b) => a.some(tag => b.includes(tag));
    const txnType = transaction.type;
    let label, bucket;

    if (/transfer|investment/.test(txnType) || mainTag === "Transfer") {
        label = mainTag;
        bucket = 'transfer';
    } else if (arraysOverlap(incomeTags, txnTags)) {
        label = mainTag;
        bucket = 'income';
    } else if (arraysOverlap(dayTags, txnTags)) {
        label = 'Day-to-Day';
        bucket = 'day';
    } else if (arraysOverlap(monthTags, txnTags)) {
        label = monthTagDict[mainTag];
        bucket = 'monthly';
    } else if (arraysOverlap(shortTermTags, txnTags)) {
        label = shortTermTagDict[mainTag];
        bucket = 'shortTerm';
    } else {
        label = 'Unbudgeted';
        bucket = 'shortTerm';
    }
    label = label || 'Day-to-Day';
    return { label, bucket };


}   
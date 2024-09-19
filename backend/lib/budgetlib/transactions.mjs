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

    if(/transfer|investment/.test(txnType) || mainTag==="Transfer") return {label: mainTag, bucket: 'transfer'};
    if(arraysOverlap(incomeTags, txnTags))      return {label: mainTag, bucket: 'income'}; 
    if(arraysOverlap(dayTags, txnTags))         return {label: 'Day-to-Day', bucket: 'day'};
    if(arraysOverlap(monthTags, txnTags))       return {label: monthTagDict[mainTag], bucket: 'monthly'};
    if(arraysOverlap(shortTermTags, txnTags))   return {label: shortTermTagDict[mainTag], bucket: 'shortTerm'};
    return {label: 'Unbudgeted', bucket: 'shortTerm'};


}   
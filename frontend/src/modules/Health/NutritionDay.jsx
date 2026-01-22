import React, { useState } from 'react';
import moment from 'moment';
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";

const NutritionDay = ({ selectedDate, selectedDateData, onDataUpdate }) => {
    const [updatingItems, setUpdatingItems] = useState(new Set());
    const [localData, setLocalData] = useState(selectedDateData);

    // Update local data when selectedDateData changes (but not during updates)
    React.useEffect(() => {
        if (updatingItems.size === 0) {
            setLocalData(selectedDateData);
        }
    }, [selectedDateData, updatingItems.size]);
    const formatNumber = (num) => {
        return Math.round(num * 10) / 10;
    };
    
    const getNoomColorEmoji = (color) => {
        const emojiMap = {
            green: '🟢',
            yellow: '🟡',
            orange: '🟠',
            red: '🔴',
            blue: '🔵'
        };
        
        return emojiMap[color] || '🔵';
    };

    const getSelectedDateTotals = () => {
        return localData.reduce((totals, item) => {
            // Nutritional values in the table are already calculated for the actual amount consumed
            // So we don't need to apply any multiplier - just sum them directly
            return {
                calories: totals.calories + (item.calories || 0),
                protein: totals.protein + (item.protein || 0),
                carbs: totals.carbs + (item.carbs || 0),
                fat: totals.fat + (item.fat || 0),
                fiber: totals.fiber + (item.fiber || 0),
                sugar: totals.sugar + (item.sugar || 0),
                sodium: totals.sodium + (item.sodium || 0),
            };
        }, {
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            fiber: 0,
            sugar: 0,
            sodium: 0,
        });
    };

    const selectedTotals = localData.length > 0 ? getSelectedDateTotals() : null;

    // CRUD operation handlers
    const handleDeleteItem = async (uuid) => {
        if (!uuid) {
            alert('Invalid item ID');
            return;
        }
        
        if (!confirm('Are you sure you want to delete this food item?')) {
            return;
        }
        
        setUpdatingItems(prev => new Set([...prev, uuid]));
        try {
            console.log('Deleting item with UUID:', uuid);
            console.log('API URL:', `health/nutrilist/${uuid}`);
            
            const response = await DaylightAPI(`api/v1/health/nutrilist/${uuid}`, {}, 'DELETE');
            console.log('Delete API Response:', response);
            
            if (response && (response.message || response.uuid)) {
                // Remove item from local data immediately for smooth UX
                setLocalData(prev => prev.filter(item => item.uuid !== uuid));
                
                // No need to update parent - optimistic update is sufficient
                // Parent will sync when drawer closes or user navigates away
            } else {
                console.error('Unexpected delete response format:', response);
                alert('Delete completed but response was unexpected. Please refresh to see changes.');
                if (onDataUpdate) {
                    onDataUpdate();
                }
            }
        } catch (error) {
            console.error('Error deleting item:', error);
            console.error('Delete error details:', {
                message: error.message,
                stack: error.stack,
                uuid: uuid
            });
            alert(`Failed to delete item: ${error.message || 'Unknown error'}. Please try again.`);
        } finally {
            setUpdatingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(uuid);
                return newSet;
            });
        }
    };

    const handleAdjustItem = async (uuid, factor) => {
        if (!uuid) {
            alert('Invalid item ID');
            return;
        }
        
        setUpdatingItems(prev => new Set([...prev, uuid]));
        try {
            // Find the current item to get its values
            const currentItem = localData.find(item => item.uuid === uuid);
            if (!currentItem) {
                alert('Item not found');
                setUpdatingItems(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(uuid);
                    return newSet;
                });
                return;
            }

            console.log('Current item:', currentItem);
            console.log('Factor:', factor);

            // Calculate new values by multiplying by the factor
            const updateData = {
                amount: Math.round((currentItem.amount || 0) * factor * 10) / 10,
                calories: Math.round((currentItem.calories || 0) * factor),
                protein: Math.round((currentItem.protein || 0) * factor * 10) / 10,
                carbs: Math.round((currentItem.carbs || 0) * factor * 10) / 10,
                fat: Math.round((currentItem.fat || 0) * factor * 10) / 10,
                fiber: Math.round((currentItem.fiber || 0) * factor * 10) / 10,
                sugar: Math.round((currentItem.sugar || 0) * factor * 10) / 10,
                sodium: Math.round((currentItem.sodium || 0) * factor * 10) / 10,
                cholesterol: Math.round((currentItem.cholesterol || 0) * factor * 10) / 10
            };

            console.log('Update data:', updateData);
            console.log('API URL:', `health/nutrilist/${uuid}`);

            const response = await DaylightAPI(`api/v1/health/nutrilist/${uuid}`, updateData, 'PUT');
            console.log('API Response:', response);
            
            if (response && (response.message || response.data)) {
                const actionText = factor > 1 ? 'increased' : 'decreased';
                
                // Update local data immediately for smooth UX
                setLocalData(prev => prev.map(item => 
                    item.uuid === uuid ? { ...item, ...updateData } : item
                ));
                
                // No need to update parent - optimistic update is sufficient
                // Parent will sync when drawer closes or user navigates away
            } else {
                console.error('Unexpected response format:', response);
                alert('Update completed but response was unexpected. Please refresh to see changes.');
                if (onDataUpdate) {
                    onDataUpdate();
                }
            }
        } catch (error) {
            console.error('Error updating item:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                uuid: uuid,
                factor: factor
            });
            alert(`Failed to update item: ${error.message || 'Unknown error'}. Please try again.`);
        } finally {
            setUpdatingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(uuid);
                return newSet;
            });
        }
    };
    return (    
        <div className="space-y-6">

            {/* Daily Totals */}
            {selectedTotals && (
                <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold mb-3">Daily Totals</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Calories</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Protein (g)</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Carbs (g)</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Fat (g)</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Fiber (g)</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Sugar (g)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-blue-600">{formatNumber(selectedTotals.calories)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-green-600">{formatNumber(selectedTotals.protein)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-yellow-600">{formatNumber(selectedTotals.carbs)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-red-600">{formatNumber(selectedTotals.fat)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-purple-600">{formatNumber(selectedTotals.fiber)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="text-xl font-bold text-pink-600">{formatNumber(selectedTotals.sugar)}</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Food Items Table */}
            <div>
                <h3 className="text-lg font-semibold mb-3">Food Items ({localData.length})</h3>
                {localData.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Edit</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Food Item</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Calories</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Protein (g)</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Carbs (g)</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Fat (g)</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Fiber (g)</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Sugar (g)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {localData.map((item, index) => {
                                    const isItemUpdating = updatingItems.has(item.uuid);
                                    return (
                                        <tr key={item.uuid || index} className={`hover:bg-gray-50 transition-all duration-200 ${isItemUpdating ? 'opacity-60 bg-gray-200 pointer-events-none text-gray-500' : 'text-gray-900'}`}>
                                            <td className="px-4 py-3 font-medium border-b text-right">
                                                <button 
                                                    className={`mx-1 px-2 py-1 rounded ${isItemUpdating ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:text-red-800'}`}
                                                    onClick={() => handleDeleteItem(item.uuid)}
                                                    disabled={isItemUpdating}
                                                    title="Delete item"
                                                >
                                                    ×
                                                </button>
                                                <button 
                                                    className={`mx-1 px-2 py-1 rounded ${isItemUpdating ? 'text-gray-400 cursor-not-allowed' : 'text-orange-600 hover:text-orange-800'}`}
                                                    onClick={() => handleAdjustItem(item.uuid, 0.9)}
                                                    disabled={isItemUpdating}
                                                    title="Decrease by 10%"
                                                >
                                                    –
                                                </button>
                                                <button 
                                                    className={`mx-1 px-2 py-1 rounded ${isItemUpdating ? 'text-gray-400 cursor-not-allowed' : 'text-green-600 hover:text-green-800'}`}
                                                    onClick={() => handleAdjustItem(item.uuid, 1.1)}
                                                    disabled={isItemUpdating}
                                                    title="Increase by 10%"
                                                >
                                                    +
                                                </button>
                                                {isItemUpdating && (
                                                    <div className="inline-block ml-2">
                                                        <div className="animate-spin rounded-full h-3 w-3 border border-gray-400 border-t-transparent"></div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm border-b text-right text-gray-600" align='right'>
                                                {item.amount ? `${item.amount} ${item.unit || 'g'}` : 'Not specified'}
                                            </td>
                                            <td className="px-4 py-3 font-medium border-b text-right">
                                                {getNoomColorEmoji(item.noom_color)} {item.item}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.calories || 0}</td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.protein || 0}</td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.carbs || 0}</td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.fat || 0}</td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.fiber || 0}</td>
                                            <td className="px-4 py-3 text-right text-sm border-b">{item.sugar || 0}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center text-gray-500 py-8">
                        No food items logged for this date
                    </div>
                )}
            </div>
        </div>
    );
};

export default NutritionDay;

import React, { useState, useEffect } from 'react';
import { Drawer } from '@mantine/core';
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";
import moment from 'moment';
import NutritionDay from './NutritionDay';

const Nutrition = () => {
    const [overviewData, setOverviewData] = useState({});
    const [selectedDateData, setSelectedDateData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);

    // Generate array of last 20 days
    const getLast20Days = () => {
        try {
            return Array.from({ length: 20 }, (_, i) => 
                moment().subtract(i, 'days').format('YYYY-MM-DD')
            ).reverse();
        } catch (error) {
            console.error('Error generating dates:', error);
            // Fallback without moment
            const dates = [];
            const today = new Date();
            for (let i = 19; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(today.getDate() - i);
                dates.push(date.toISOString().split('T')[0]);
            }
            return dates;
        }
    };

    const fetchOverviewData = async () => {
        try {
            setLoading(true);
            setError(null);
            
            console.log('Starting to fetch overview data...');
            const days = getLast20Days();
            console.log('Days to fetch:', days);
            
            const overviewPromises = days.map(async (date) => {
                try {
                    const response = await DaylightAPI(`health/nutrilist/${date}`);
                    console.log(`Data for ${date}:`, response);
                    return { date, data: response.data || [] };
                } catch (error) {
                    console.error(`Error fetching data for ${date}:`, error);
                    return { date, data: [] };
                }
            });
            
            const results = await Promise.all(overviewPromises);
            const overviewMap = {};
            results.forEach(({ date, data }) => {
                overviewMap[date] = data;
            });
            
            console.log('Final overview data:', overviewMap);
            setOverviewData(overviewMap);
        } catch (error) {
            console.error('Error fetching overview data:', error);
            setError('Failed to fetch nutrition overview: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const openDateDrawer = (date) => {
        setSelectedDate(date);
        setSelectedDateData(overviewData[date] || []);
        setDrawerOpen(true);
    };

    const handleDataUpdate = async () => {
        // Only refresh the specific date data, not the entire overview
        if (selectedDate) {
            try {
                const response = await DaylightAPI(`health/nutrilist/${selectedDate}`);
                setSelectedDateData(response.data || []);
                
                // Update the overview data for this specific date without re-fetching everything
                setOverviewData(prev => ({
                    ...prev,
                    [selectedDate]: response.data || []
                }));
            } catch (error) {
                console.error('Error refreshing date data:', error);
            }
        }
    };

    useEffect(() => {
        fetchOverviewData();
    }, []);

    const getDayTotals = (dayData) => {
        return dayData.reduce((totals, item) => {
            // Nutritional values are already calculated for the actual amount consumed
            // So we don't need to apply any multiplier - just sum them directly
            return {
                calories: totals.calories + (item.calories || 0),
                protein: totals.protein + (item.protein || 0),
                carbs: totals.carbs + (item.carbs || 0),
                fat: totals.fat + (item.fat || 0),
            };
        }, {
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
        });
    };

    const formatNumber = (num) => {
        return Math.round(num);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="text-lg">Loading nutrition overview...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                {error}
            </div>
        );
    }

    const days = getLast20Days();

    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900 mb-4">Nutrition Overview - Last 20 Days</h1>
                <p className="text-gray-600 mb-4">Click on any date to view detailed nutrition information for that day.</p>
            </div>

            {/* Overview Chart */}
            <div className="bg-white shadow-lg rounded-lg overflow-hidden p-6">
                <table className="w-full">
                    <tbody>
                        <tr style={{ height: '300px' }}>
                            {days.map(date => {
                                const dayData = overviewData[date] || [];
                                const totals = getDayTotals(dayData);
                                
                                // Calculate heights for stacked bars (max height 250px)
                                const maxCalories = Math.max(...days.map(d => {
                                    const data = overviewData[d] || [];
                                    return getDayTotals(data).calories;
                                }));
                                
                                const barHeight = maxCalories > 0 ? Math.min((totals.calories / maxCalories) * 250, 250) : 0;
                                
                                // Calculate proportions for macros
                                const totalMacros = totals.protein + totals.carbs + totals.fat;
                                const proteinHeight = totalMacros > 0 ? (totals.protein / totalMacros) * barHeight : 0;
                                const carbsHeight = totalMacros > 0 ? (totals.carbs / totalMacros) * barHeight : 0;
                                const fatHeight = totalMacros > 0 ? (totals.fat / totalMacros) * barHeight : 0;
                                
                                return (
                                    <td 
                                        key={date}
                                        className="align-bottom text-center px-2 cursor-pointer hover:bg-gray-50 transition-colors"
                                        onClick={() => openDateDrawer(date)}
                                        style={{ width: '120px', cursor: 'pointer' }}
                                    >
                                        <div className="flex flex-col items-center h-full justify-end" style={{ cursor: 'pointer' }}>
                                            {/* Calories on top */}
                                            <div className="mb-2 font-bold text-lg">
                                                {dayData.length > 0 ? Math.round(totals.calories) : ''}
                                            </div>
                                            
                                            {/* Stacked Bar */}
                                            {dayData.length > 0 && (
                                                <div 
                                                    className="w-16 border border-gray-300 flex flex-col justify-end relative"
                                                    style={{ height: '250px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', cursor: 'pointer' }}
                                                >
                                                    {/* Protein (bottom - red) */}
                                                    {proteinHeight > 0 && (
                                                        <div 
                                                            style={{ 
                                                                height: `${proteinHeight}px`,
                                                                backgroundColor: '#E57373',
                                                                display: 'flex',
                                                                alignItems: 'flex-end',
                                                                justifyContent: 'center',
                                                                cursor: 'pointer'
                                                            }}
                                                            className="text-white text-xs font-medium"
                                                        >
                                                            {formatNumber(totals.protein)}g
                                                        </div>
                                                    )}
                                                    
                                                    {/* Carbs (middle - yellow) */}
                                                    {carbsHeight > 0 && (
                                                        <div 
                                                            style={{ 
                                                                height: `${carbsHeight}px`,
                                                                backgroundColor: '#F2C464',
                                                                display: 'flex',
                                                                alignItems: 'flex-end',
                                                                justifyContent: 'center',
                                                                cursor: 'pointer'
                                                            }}
                                                            className="text-gray-800 text-xs font-medium"
                                                        >
                                                            {formatNumber(totals.carbs)}g
                                                        </div>
                                                    )}
                                                    
                                                    {/* Fat (top - green) */}
                                                    {fatHeight > 0 && (
                                                        <div 
                                                            style={{ 
                                                                height: `${fatHeight}px`,
                                                                backgroundColor: '#86A789',
                                                                cursor: 'pointer'
                                                            }}
                                                            className="flex items-center justify-center text-white text-xs font-medium"
                                                        >
                                                            {formatNumber(totals.fat)}g
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Date labels */}
                                            <div className="mt-2" style={{ cursor: 'pointer' }}>
                                                <div className="font-medium">{moment(date).format('ddd')}</div>
                                                <div className="text-sm text-gray-600">{moment(date).format('MMM D')}</div>
                                            </div>
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
                

            </div>

            {/* Drawer for Daily Details */}
            <Drawer
                opened={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false);
                    // Sync data when drawer closes to ensure overview is updated
                    if (selectedDate) {
                        DaylightAPI(`health/nutrilist/${selectedDate}`)
                            .then(response => {
                                setOverviewData(prev => ({
                                    ...prev,
                                    [selectedDate]: response.data || []
                                }));
                            })
                            .catch(console.error);
                    }
                }}
                title={`Nutrition Details - ${selectedDate ? moment(selectedDate).format('MMMM D, YYYY') : ''}`}
                position="right"
                size="90%"
            >
                {selectedDate && (
                    <NutritionDay 
                        selectedDate={selectedDate}
                        selectedDateData={selectedDateData}
                        onDataUpdate={handleDataUpdate}
                    />
                )}
            </Drawer>
        </div>
    );
};

export default Nutrition;
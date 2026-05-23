'use client'

import { useState } from 'react'
import { logger } from '@/lib/logger'

export default function TestSidebarPage() {
    const [activeTab, setActiveTab] = useState('tab1')

    const handleTabChange = (tabId: string) => {
        logger.debug('Tab clicked:', tabId)
        setActiveTab(tabId)
    }

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-4">测试侧边栏点击功能</h1>

            <div className="flex gap-4 mb-8">
                <button
                    onClick={() => handleTabChange('tab1')}
                    className={`px-4 py-2 rounded ${activeTab === 'tab1' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                    Tab 1
                </button>
                <button
                    onClick={() => handleTabChange('tab2')}
                    className={`px-4 py-2 rounded ${activeTab === 'tab2' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                    Tab 2
                </button>
                <button
                    onClick={() => handleTabChange('tab3')}
                    className={`px-4 py-2 rounded ${activeTab === 'tab3' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                    Tab 3
                </button>
            </div>

            <div className="p-4 border rounded">
                <p>当前激活的 Tab: <strong>{activeTab}</strong></p>
            </div>

            <div className="mt-8 p-4 bg-gray-100 rounded">
                <p className="text-sm text-gray-600">
                    打开浏览器控制台查看点击日志。如果这个简单的测试页面工作正常，
                    说明 React 状态更新没有问题，问题可能在侧边栏组件的实现中。
                </p>
            </div>
        </div>
    )
}

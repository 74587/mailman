'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FlaskConical, Palette, Layout, Type, MousePointer } from 'lucide-react'

export default function ComponentTestPage() {
    const [inputValue, setInputValue] = useState('')

    return (
        <div className="container mx-auto py-8 px-6">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                    <FlaskConical className="h-6 w-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                        组件测试
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        测试和预览UI组件
                    </p>
                </div>
            </div>

            <Tabs defaultValue="buttons" className="w-full">
                <TabsList className="grid w-full grid-cols-4 mb-6">
                    <TabsTrigger value="buttons" className="flex items-center gap-2">
                        <MousePointer className="h-4 w-4" />
                        按钮
                    </TabsTrigger>
                    <TabsTrigger value="inputs" className="flex items-center gap-2">
                        <Type className="h-4 w-4" />
                        输入框
                    </TabsTrigger>
                    <TabsTrigger value="cards" className="flex items-center gap-2">
                        <Layout className="h-4 w-4" />
                        卡片
                    </TabsTrigger>
                    <TabsTrigger value="colors" className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        颜色
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="buttons">
                    <Card>
                        <CardHeader>
                            <CardTitle>按钮组件</CardTitle>
                            <CardDescription>测试不同样式的按钮组件</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label>默认按钮</Label>
                                <div className="flex flex-wrap gap-2">
                                    <Button>默认</Button>
                                    <Button variant="secondary">次要</Button>
                                    <Button variant="destructive">危险</Button>
                                    <Button variant="outline">边框</Button>
                                    <Button variant="ghost">幽灵</Button>
                                    <Button variant="link">链接</Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>按钮尺寸</Label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button size="sm">小</Button>
                                    <Button size="default">默认</Button>
                                    <Button size="lg">大</Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>禁用状态</Label>
                                <div className="flex flex-wrap gap-2">
                                    <Button disabled>禁用按钮</Button>
                                    <Button variant="secondary" disabled>禁用次要</Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="inputs">
                    <Card>
                        <CardHeader>
                            <CardTitle>输入组件</CardTitle>
                            <CardDescription>测试输入框组件</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="test-input">普通输入框</Label>
                                <Input
                                    id="test-input"
                                    placeholder="请输入内容..."
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>禁用输入框</Label>
                                <Input placeholder="禁用状态" disabled />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="cards">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>基础卡片</CardTitle>
                                <CardDescription>这是一个基础卡片组件</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    卡片内容区域
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="border-blue-200 dark:border-blue-800">
                            <CardHeader>
                                <CardTitle className="text-blue-600 dark:text-blue-400">蓝色卡片</CardTitle>
                                <CardDescription>带有颜色边框的卡片</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    自定义边框颜色
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
                            <CardHeader>
                                <CardTitle>渐变卡片</CardTitle>
                                <CardDescription>带有渐变背景的卡片</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    渐变背景效果
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="colors">
                    <Card>
                        <CardHeader>
                            <CardTitle>调色板</CardTitle>
                            <CardDescription>系统颜色预览</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {[
                                    { name: 'Primary', class: 'bg-primary-500' },
                                    { name: 'Blue', class: 'bg-blue-500' },
                                    { name: 'Green', class: 'bg-green-500' },
                                    { name: 'Yellow', class: 'bg-yellow-500' },
                                    { name: 'Red', class: 'bg-red-500' },
                                    { name: 'Purple', class: 'bg-purple-500' },
                                    { name: 'Pink', class: 'bg-pink-500' },
                                    { name: 'Indigo', class: 'bg-indigo-500' },
                                    { name: 'Gray', class: 'bg-gray-500' },
                                    { name: 'Slate', class: 'bg-slate-500' },
                                    { name: 'Orange', class: 'bg-orange-500' },
                                    { name: 'Teal', class: 'bg-teal-500' },
                                ].map((color) => (
                                    <div key={color.name} className="text-center">
                                        <div className={`${color.class} w-full h-16 rounded-lg shadow-md`} />
                                        <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                            {color.name}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

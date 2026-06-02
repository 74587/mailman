'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Interceptor, InterceptorPluginInfo } from '@/services/interceptor.service'
import { Badge } from '@/components/ui/badge'
import { PluginConfigForm } from '@/components/plugins/plugin-config-form'

interface BasicInfoStepProps {
    formData: Partial<Interceptor>
    plugins: InterceptorPluginInfo[]
    currentPlugin: InterceptorPluginInfo | undefined
    onChange: (updates: Partial<Interceptor>) => void
}

export function BasicInfoStep({
    formData,
    plugins,
    currentPlugin,
    onChange,
}: BasicInfoStepProps) {
    return (
        <div className="space-y-6">
            {/* 拦截器名称 */}
            <div className="space-y-2">
                <Label htmlFor="name">
                    拦截器名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                    id="name"
                    placeholder="例如: 日志记录拦截器"
                    value={formData.name || ''}
                    onChange={(e) => onChange({ name: e.target.value })}
                />
            </div>

            {/* 描述 */}
            <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                    id="description"
                    placeholder="简要描述拦截器的用途..."
                    value={formData.description || ''}
                    onChange={(e) => onChange({ description: e.target.value })}
                    rows={3}
                />
            </div>

            {/* 选择插件 */}
            <div className="space-y-2">
                <Label>
                    选择拦截器插件 <span className="text-destructive">*</span>
                </Label>
                <Select
                    value={formData.plugin_id || ''}
                    onValueChange={(value) => {
                        const plugin = plugins.find((p) => p.id === value)
                        onChange({
                            plugin_id: value,
                            plugin_config: plugin?.default_config || {},
                        })
                    }}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="选择一个拦截器插件" />
                    </SelectTrigger>
                    <SelectContent>
                        {plugins.map((plugin) => (
                            <SelectItem key={plugin.id} value={plugin.id}>
                                <div className="flex items-center gap-2">
                                    <span>{plugin.name}</span>
                                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {currentPlugin && (
                    <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">{currentPlugin.description}</p>
                        <div className="flex items-center gap-2">
                            {currentPlugin.supports_before && (
                                <Badge variant="outline" className="bg-blue-500/20 text-blue-400">
                                    支持前置
                                </Badge>
                            )}
                            {currentPlugin.supports_after && (
                                <Badge variant="outline" className="bg-green-500/20 text-green-400">
                                    支持后置
                                </Badge>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 执行顺序 */}
            <div className="space-y-2">
                <Label htmlFor="order">执行顺序</Label>
                <div className="flex items-center gap-2">
                    <Input
                        id="order"
                        type="number"
                        className="w-32"
                        value={formData.order || 100}
                        onChange={(e) => onChange({ order: parseInt(e.target.value) || 100 })}
                    />
                    <span className="text-sm text-muted-foreground">(数值越小越先执行)</span>
                </div>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center justify-between p-4 rounded-lg border">
                <div className="space-y-0.5">
                    <Label>启用此拦截器</Label>
                    <p className="text-sm text-muted-foreground">禁用后拦截器将不会执行</p>
                </div>
                <Switch
                    checked={formData.enabled ?? true}
                    onCheckedChange={(checked) => onChange({ enabled: checked })}
                />
            </div>

            {/* 插件配置 - 如果有配置项 */}
            {currentPlugin?.config_schema && Object.keys(currentPlugin.config_schema).length > 0 && (
                <div className="space-y-3">
                    <Label>插件配置</Label>
                    <div className="p-4 rounded-lg border space-y-4">
                        <PluginConfigForm
                            schema={currentPlugin.config_schema}
                            value={formData.plugin_config || {}}
                            onChange={(newConfig) => onChange({ plugin_config: newConfig })}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}

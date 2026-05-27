package builtin

import "mailman/internal/triggerv2/plugins"

const (
	PluginContextTrigger     = "trigger"
	PluginContextPickup      = "pickup"
	PluginContextInterceptor = "interceptor"

	PluginCapabilityCondition    = "condition"
	PluginCapabilityPure         = "pure"
	PluginCapabilityTransform    = "transform"
	PluginCapabilityExtraction   = "extraction"
	PluginCapabilityControlFlow  = "control_flow"
	PluginCapabilityComposite    = "composite"
	PluginCapabilityMutatesEmail = "mutates_email"
	PluginCapabilityNotification = "notification"
	PluginCapabilityNetwork      = "network"
	PluginCapabilityAI           = "ai"
	PluginCapabilityDeprecated   = "deprecated"
)

type builtinPluginPolicy struct {
	Capabilities []string
	Contexts     []string
}

var builtinPluginPolicies = map[string]builtinPluginPolicy{
	"always_pass": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"builtin.email_condition": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_filter": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_account_set": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityNetwork},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_prefix": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_suffix": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_time_range": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"email_size": {
		Capabilities: []string{PluginCapabilityCondition, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup, PluginContextInterceptor},
	},
	"variable_extract_action": {
		Capabilities: []string{PluginCapabilityExtraction, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"email_transform_action": {
		Capabilities: []string{PluginCapabilityTransform, PluginCapabilityPure, PluginCapabilityDeprecated},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"email_transform_action_v2": {
		Capabilities: []string{PluginCapabilityTransform, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"conditional_branch_action": {
		Capabilities: []string{PluginCapabilityControlFlow, PluginCapabilityComposite, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"parallel_actions": {
		Capabilities: []string{PluginCapabilityComposite, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"return_action": {
		Capabilities: []string{PluginCapabilityControlFlow, PluginCapabilityPure},
		Contexts:     []string{PluginContextTrigger, PluginContextPickup},
	},
	"notification_action": {
		Capabilities: []string{PluginCapabilityNotification},
		Contexts:     []string{PluginContextTrigger},
	},
	"email_forward_action": {
		Capabilities: []string{PluginCapabilityMutatesEmail, PluginCapabilityNetwork},
		Contexts:     []string{PluginContextTrigger},
	},
	"email_delete_action": {
		Capabilities: []string{PluginCapabilityMutatesEmail},
		Contexts:     []string{PluginContextTrigger},
	},
	"email_label_action": {
		Capabilities: []string{PluginCapabilityMutatesEmail},
		Contexts:     []string{PluginContextTrigger},
	},
	"webhook_action": {
		Capabilities: []string{PluginCapabilityNetwork, PluginCapabilityNotification},
		Contexts:     []string{PluginContextTrigger},
	},
	"telegram_bot_action": {
		Capabilities: []string{PluginCapabilityNetwork, PluginCapabilityNotification},
		Contexts:     []string{PluginContextTrigger},
	},
	"ai_process_action": {
		Capabilities: []string{PluginCapabilityAI, PluginCapabilityNetwork},
		Contexts:     []string{PluginContextTrigger},
	},
}

func ApplyBuiltinPluginPolicy(info *plugins.PluginInfo) *plugins.PluginInfo {
	if info == nil {
		return nil
	}

	policy := getBuiltinPluginPolicy(info)
	info.Capabilities = append([]string(nil), policy.Capabilities...)
	info.Contexts = append([]string(nil), policy.Contexts...)
	return info
}

func BuiltinPluginPolicy(pluginID string) ([]string, []string) {
	policy, ok := builtinPluginPolicies[pluginID]
	if !ok {
		return nil, nil
	}
	return append([]string(nil), policy.Capabilities...), append([]string(nil), policy.Contexts...)
}

func IsPluginAllowedInContext(info *plugins.PluginInfo, context string) bool {
	if context == "" {
		return true
	}
	if info == nil {
		return false
	}

	contexts := info.Contexts
	if len(contexts) == 0 {
		if _, builtinContexts := BuiltinPluginPolicy(info.ID); len(builtinContexts) > 0 {
			contexts = builtinContexts
		} else {
			contexts = []string{PluginContextTrigger}
		}
	}

	return policyContainsString(contexts, context)
}

func IsPluginAllowedInContextByID(pluginID string, context string) bool {
	if context == "" {
		return true
	}
	_, contexts := BuiltinPluginPolicy(pluginID)
	return policyContainsString(contexts, context)
}

func getBuiltinPluginPolicy(info *plugins.PluginInfo) builtinPluginPolicy {
	if policy, ok := builtinPluginPolicies[info.ID]; ok {
		return policy
	}

	capabilities := []string{}
	switch info.Type {
	case plugins.PluginTypeCondition:
		capabilities = append(capabilities, PluginCapabilityCondition, PluginCapabilityPure)
	case plugins.PluginTypeAction:
		capabilities = append(capabilities, PluginCapabilityTransform)
	}

	return builtinPluginPolicy{
		Capabilities: capabilities,
		Contexts:     []string{PluginContextTrigger},
	}
}

func policyContainsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

<script setup lang="ts">
import type { Component, StyleValue } from "vue";
import { usePopupZIndex } from "@/composables/useZIndex";

export interface SSelectOption {
  value: string | number | boolean;
  label: string;
  /** 单条选项的内联样式 */
  style?: StyleValue;
  /** 不可达的单个档位保持可见但禁止选择 */
  disabled?: boolean;
  /** 选项前缀装饰图标（aria-hidden，仅在菜单与选中值中展示） */
  icon?: Component;
}

export interface SSelectProps {
  modelValue?: string | number | boolean;
  options?: SSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  /** 全圆角胶囊形 */
  round?: boolean;
}

const props = withDefaults(defineProps<SSelectProps>(), {
  options: () => [],
  disabled: false,
  placeholder: "",
  round: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number | boolean];
}>();

const { zIndex, onOpenChange } = usePopupZIndex();

/** 当前选中项，触发器展示装饰图标 + 纯文本标签 */
const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue));

const handleChange = (val: string) => {
  const opt = props.options.find((o) => String(o.value) === val);
  if (opt?.disabled) return;
  emit("update:modelValue", opt?.value ?? val);
};
</script>

<template>
  <SelectRoot
    :model-value="String(modelValue)"
    :disabled="disabled"
    @update:model-value="handleChange"
    @update:open="onOpenChange"
  >
    <SelectTrigger
      class="group flex w-full items-center justify-between gap-2 h-8.5 px-3 text-sm text-on-surface bg-field border border-solid border-on-surface/20 cursor-pointer outline-none focus-visible:outline-none transition-[border-color,box-shadow,opacity] duration-250 hover:border-on-surface/50 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/25 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
      :class="round ? 'rounded-full' : 'rounded-lg'"
    >
      <SelectValue class="min-w-0">
        <span class="flex min-w-0 items-center gap-2">
          <component
            :is="selectedOption?.icon"
            v-if="selectedOption?.icon"
            class="size-4 shrink-0"
          />
          <span class="truncate">{{ selectedOption?.label ?? placeholder }}</span>
        </span>
      </SelectValue>
      <SelectIcon as-child>
        <IconLucideChevronDown
          class="size-3.5 text-on-surface-variant/50 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        :collision-padding="12"
        :style="{ zIndex }"
        class="max-h-60 w-[var(--reka-select-trigger-width)] overflow-hidden rounded-xl bg-surface-bright shadow-lg data-[state=open]:animate-select-in data-[state=closed]:animate-select-out"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :disabled="opt.disabled"
            :title="opt.label"
            :style="opt.style"
            class="relative flex items-center h-8.5 px-3 pr-8 text-sm rounded-md cursor-pointer outline-none focus-visible:outline-none transition-[background-color,color] duration-200 data-[highlighted]:bg-on-surface/8 data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed"
            :class="opt.value === modelValue ? 'text-primary' : 'text-on-surface'"
          >
            <SelectItemText class="flex min-w-0 items-center gap-2">
              <component :is="opt.icon" v-if="opt.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ opt.label }}</span>
            </SelectItemText>
            <SelectItemIndicator class="absolute right-2">
              <IconLucideCheck class="size-3.5 text-primary" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

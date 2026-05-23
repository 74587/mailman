'use client'

import React, { useState, useEffect, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

// Context for tooltip provider settings
interface TooltipContextType {
  delayDuration: number
}

const TooltipContext = createContext<TooltipContextType>({ delayDuration: 500 })

// Tooltip Provider with configurable delay
export const TooltipProvider = ({
  children,
  delayDuration = 500
}: {
  children: React.ReactNode
  delayDuration?: number
}) => {
  return (
    <TooltipContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipContext.Provider>
  )
}

interface TooltipContentProps {
  children: React.ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

import { createPortal } from 'react-dom'

export function Tooltip({ children }: { children: React.ReactNode }) {
  const { delayDuration } = useContext(TooltipContext)
  const [isVisible, setIsVisible] = useState(false)
  const [showTimeout, setShowTimeout] = useState<NodeJS.Timeout | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // Default to top center for now, can be expanded for other sides
      setPosition({
        top: rect.top - 8, // slight gap
        left: rect.left + rect.width / 2
      })
    }
  }

  const handleMouseEnter = () => {
    updatePosition()
    const timeout = setTimeout(() => {
      updatePosition() // Update again just in case
      setIsVisible(true)
    }, delayDuration)
    setShowTimeout(timeout)
  }

  const handleMouseLeave = () => {
    if (showTimeout) {
      clearTimeout(showTimeout)
      setShowTimeout(null)
    }
    setIsVisible(false)
  }

  useEffect(() => {
    // Hide tooltip on scroll to prevent detached look
    const handleScroll = () => {
      if (isVisible) setIsVisible(false)
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [isVisible])

  useEffect(() => {
    return () => {
      if (showTimeout) {
        clearTimeout(showTimeout)
      }
    }
  }, [showTimeout])

  let trigger: React.ReactNode = null
  let content: React.ReactNode = null
  let contentClassName = ''

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === TooltipTrigger) {
        trigger = child.props.children
      } else if (child.type === TooltipContent) {
        content = child.props.children
        contentClassName = child.props.className || ''
      }
    }
  })

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {trigger}
      </div>

      {mounted && isVisible && content && createPortal(
        <div
          className={cn(
            "fixed z-[9999] pointer-events-none transform -translate-x-1/2 -translate-y-full px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-md whitespace-nowrap",
            contentClassName
          )}
          style={{
            top: position.top,
            left: position.left,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  )
}

export const TooltipTrigger = ({
  children,
  asChild
}: {
  children: React.ReactNode
  asChild?: boolean
}) => {
  return <>{children}</>
}

export const TooltipContent = ({
  children,
  className,
  side = 'top',
  align = 'center'
}: TooltipContentProps) => {
  return <>{children}</>
}
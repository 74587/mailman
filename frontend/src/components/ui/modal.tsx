'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Modal - A reusable modal component built on Radix UI Dialog
 * 
 * This component provides:
 * - Automatic scroll lock
 * - Focus trap
 * - ESC to close
 * - Click outside to close (optional)
 * - Smooth animations
 * - Full accessibility (WAI-ARIA)
 * 
 * @example
 * <Modal open={isOpen} onOpenChange={setIsOpen}>
 *   <ModalContent size="lg">
 *     <ModalHeader>
 *       <ModalTitle>Title</ModalTitle>
 *       <ModalDescription>Description</ModalDescription>
 *     </ModalHeader>
 *     <ModalBody>Content</ModalBody>
 *     <ModalFooter>Footer</ModalFooter>
 *   </ModalContent>
 * </Modal>
 */

const Modal = DialogPrimitive.Root

const ModalTrigger = DialogPrimitive.Trigger

const ModalPortal = DialogPrimitive.Portal

const ModalClose = DialogPrimitive.Close

const ModalOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            "fixed inset-0 z-50 bg-black/50 dark:bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className
        )}
        {...props}
    />
))
ModalOverlay.displayName = DialogPrimitive.Overlay.displayName

interface ModalContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    /** Modal size: sm, md, lg, xl, 2xl, 6xl, full */
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '6xl' | 'full'
    /** Show close button in top right */
    showCloseButton?: boolean
    /** Prevent closing on overlay click */
    preventClose?: boolean
    /** Custom className for the overlay (useful for z-index overrides in stacked modals) */
    overlayClassName?: string
}

const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '6xl': 'max-w-6xl',
    full: 'max-w-[90vw]'
}

const ModalContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    ModalContentProps
>(({ className, children, size = 'lg', showCloseButton = true, preventClose = false, overlayClassName, ...props }, ref) => (
    <ModalPortal>
        <ModalOverlay className={overlayClassName} />
        <DialogPrimitive.Content
            ref={ref}
            onPointerDownOutside={preventClose ? (e) => e.preventDefault() : undefined}
            onEscapeKeyDown={preventClose ? (e) => e.preventDefault() : undefined}
            className={cn(
                "fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-0 border bg-white shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-xl dark:border-gray-700 dark:bg-gray-800 max-h-[90vh] flex flex-col",
                sizeClasses[size],
                className
            )}
            {...props}
        >
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 opacity-70 ring-offset-white transition-opacity hover:opacity-100 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:pointer-events-none dark:ring-offset-gray-950 dark:focus:ring-gray-800 dark:hover:bg-gray-700">
                    <X className="h-5 w-5" />
                    <span className="sr-only">关闭</span>
                </DialogPrimitive.Close>
            )}
        </DialogPrimitive.Content>
    </ModalPortal>
))
ModalContent.displayName = DialogPrimitive.Content.displayName

const ModalHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col space-y-1.5 border-b border-gray-200 p-6 dark:border-gray-700",
            className
        )}
        {...props}
    />
)
ModalHeader.displayName = 'ModalHeader'

const ModalBody = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex-1 overflow-y-auto p-6",
            className
        )}
        {...props}
    />
)
ModalBody.displayName = 'ModalBody'

const ModalFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex items-center justify-end space-x-3 border-t border-gray-200 p-6 dark:border-gray-700",
            className
        )}
        {...props}
    />
)
ModalFooter.displayName = 'ModalFooter'

const ModalTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn(
            "text-xl font-semibold leading-none tracking-tight text-gray-900 dark:text-white",
            className
        )}
        {...props}
    />
))
ModalTitle.displayName = DialogPrimitive.Title.displayName

const ModalDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn("mt-1 text-sm text-gray-500 dark:text-gray-400", className)}
        {...props}
    />
))
ModalDescription.displayName = DialogPrimitive.Description.displayName

export {
    Modal,
    ModalPortal,
    ModalOverlay,
    ModalClose,
    ModalTrigger,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription,
}

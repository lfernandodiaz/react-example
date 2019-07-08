import classNames from 'classnames'
import gql from 'graphql-tag'
import {
  map,
  partition,
  path,
  pathOr,
  pick,
  differenceWith,
  isNil,
  prop,
} from 'ramda'
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useContext,
  useMemo,
} from 'react'
import { compose, graphql, withApollo } from 'react-apollo'
import { injectIntl } from 'react-intl'
import { Button, ToastContext } from 'vtex.styleguide'
import { useRuntime } from 'vtex.render-runtime'
import { IconCart } from 'vtex.store-icons'
import { addToCart, updateItems } from 'vtex.store-resources/Mutations'
import { usePixel } from 'vtex.pixel-manager/PixelContext'

import MiniCartContent from './components/MiniCartContent'
import Sidebar from './components/Sidebar'
import Popup from './components/Popup'
import { shouldShowItem } from './utils/itemsHelper'

import { fullMinicartQuery } from './localState/queries'
import {
  updateItemsMutation,
  updateOrderFormMutation,
  updateLocalItemStatusMutation,
  setMinicartOpenMutation,
} from './localState/mutations'

import createLocalState, { ITEMS_STATUS } from './localState'

import styles from './minicart.css'

const MINICART_QUERY = gql`
  query MinicartQuery {
    orderForm @context(provider: "vtex.store-graphql") {
      cacheId
      orderFormId
      value
      totalizers {
        id
        name
        value
      }
      items {
        id
        name
        imageUrl
        detailUrl
        skuName
        quantity
        sellingPrice
        listPrice
        parentItemIndex
        parentAssemblyBinding
        cartIndex
        assemblyOptions {
          added {
            item {
              name
              sellingPrice
              quantity
            }
            normalizedQuantity
            choiceType
            extraQuantity
          }
          removed {
            removedQuantity
            initialQuantity
            name
          }
          parentPrice
        }
        seller
      }
      shippingData {
        address {
          id
          neighborhood
          complement
          number
          street
          postalCode
          city
          reference
          addressName
          addressType
          geoCoordinates
          state
          receiverName
          country
        }
        availableAddresses {
          id
          neighborhood
          complement
          number
          street
          postalCode
          city
          reference
          addressName
          addressType
          geoCoordinates
          state
          receiverName
          country
        }
      }
      clientProfileData {
        email
        firstName
      }
      storePreferencesData {
        countryCode
        currencyCode
        timeZone
      }
      checkedInPickupPointId
      isCheckedIn
    }
    minicart @client {
      items
      orderForm
      isOpen
    }
  }
`

const DEFAULT_LABEL_CLASSES = ''
const DEFAULT_ICON_CLASSES = 'gray'

const useOffline = () => {
  const [isOffline, setOffline] = useState(() =>
    typeof navigator !== 'undefined'
      ? !pathOr(true, ['onLine'], navigator)
      : false
  )

  useEffect(() => {
    const updateStatus = () => {
      if (navigator) {
        const offline = !pathOr(true, ['onLine'], navigator)
        setOffline(offline)
      }
    }

    window.addEventListener('online', updateStatus)
    window.addEventListener('offline', updateStatus)

    return () => {
      window.removeEventListener('online', updateStatus)
      window.removeEventListener('offline', updateStatus)
    }
  }, [])

  return isOffline
}

const useLinkState = client => {
  useEffect(() => {
    const { resolvers, initialState } = createLocalState(client)
    client.addResolvers(resolvers)
    // Add the initial state to if there is not there
    try {
      client.readQuery({ query: fullMinicartQuery })
    } catch (err) {
      client.writeData({ data: initialState })
    }

    const minicartData = JSON.parse(localStorage.getItem('minicart'))

    if (minicartData) {
      client.writeData({
        data: {
          minicart: {
            __typename: 'Minicart',
            items: JSON.stringify(minicartData),
          },
        },
      })
    }
  }, [client])
}

const getAddToCartEventItems = ({
  id: skuId,
  skuName: variant,
  sellingPrice: price,
  ...restSkuItem
}) => {
  return {
    skuId,
    variant,
    price,
    ...pick(['brand', 'name', 'quantity'], restSkuItem),
  }
}

const partitionItemsAddUpdate = clientItems => {
  return partition(
    compose(
      isNil,
      prop('cartIndex')
    ),
    clientItems
  )
}

/**
 * Minicart component
 */
const MiniCart = ({
  labelClasses = DEFAULT_LABEL_CLASSES,
  iconClasses = DEFAULT_ICON_CLASSES,
  client,
  setMinicartOpen,
  labelMiniCartEmpty,
  labelButtonFinishShopping,
  iconSize,
  iconLabel,
  showTotalItemsQty,
  showDiscount,
  data,
  type,
  hideContent,
  showShippingCost,
  updateOrderForm,
  intl,
  updateItemsMutation,
  addToCartMutation,
  updateLocalItemStatus,
}) => {
  useLinkState(client)

  const [isUpdatingOrderForm, setUpdatingOrderForm] = useState(false)
  const isOffline = useOffline()

  const {
    hints: { mobile },
    navigate,
  } = useRuntime()
  const { push } = usePixel()
  const { showToast } = useContext(ToastContext)

  const orderForm = pathOr(
    path(['minicart', 'orderForm'], data),
    ['orderForm'],
    data
  )
  const orderFormId = orderForm && orderForm.orderFormId

  const minicartState = data.minicart || {}

  const minicartItems = useMemo(() => {
    try {
      return JSON.parse(minicartState.items)
    } catch (e) {
      return []
    }
  }, [minicartState.items])

  const modifiedItems = useMemo(
    () =>
      minicartItems.filter(
        ({ localStatus }) => localStatus === ITEMS_STATUS.MODIFIED
      ),
    [minicartItems]
  )

  // update local state order form
  useEffect(
    () => {
      const updateLocalOrderForm = async () => {
        const orderFormData = JSON.parse(localStorage.getItem('orderForm'))

        const remoteOrderForm = data.orderForm

        if (remoteOrderForm || !orderFormData) {
          if (!path(['orderForm'], minicartState) && remoteOrderForm) {
            await updateOrderForm(remoteOrderForm)
          }
        } else if (!path(['orderForm'], minicartState)) {
          await updateOrderForm(orderFormData)
        }
      }

      updateLocalOrderForm()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, minicartState]
  )

  // synchronize values with local storage
  useEffect(() => {
    if (orderForm) {
      localStorage.setItem('minicart', JSON.stringify(minicartItems))
      localStorage.setItem('orderForm', JSON.stringify(orderForm))
    }
  }, [minicartItems, orderForm])

  const addItems = useCallback(
    items => {
      if (!items.length || !orderFormId) {
        return null
      }

      return addToCartMutation({
        variables: { orderFormId, items },
      })
    },
    [orderFormId, addToCartMutation]
  )

  const mutateUpdateItems = useCallback(
    items => {
      if (!items.length || !orderFormId) {
        return null
      }

      return updateItemsMutation({
        variables: { orderFormId, items },
      })
    },
    [orderFormId, updateItemsMutation]
  )

  const prevMinicartItems = useRef(minicartItems)

  useEffect(() => {
    prevMinicartItems.current = minicartItems
  }, [minicartItems])

  useEffect(() => {
    const productDifference = differenceWith((a, b) => a.id === b.id)

    const addedItems = productDifference(
      minicartItems,
      prevMinicartItems.current
    )

    const removedItems = productDifference(
      prevMinicartItems.current,
      minicartItems
    )

    if (removedItems.length) {
      push({
        event: 'removeFromCart',
        items: removedItems,
      })
    }

    if (addedItems.length) {
      push({
        event: 'addToCart',
        items: map(getAddToCartEventItems, addedItems),
      })
    }
  }, [minicartItems, push])

  const orderFormRef = useRef(orderForm)

  useEffect(() => {
    orderFormRef.current = orderForm
  }, [orderForm])

  useEffect(
    () => {
      if (!isOffline) {
        updateLocalItemStatus()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOffline]
  )

  useEffect(
    () => {
      let isCurrent = true

      const syncItemsWithServer = async () => {
        if (!modifiedItems.length) {
          return
        }

        const prevOrderForm = orderFormRef.current

        try {
          setUpdatingOrderForm(true)

          const [itemsToAdd, itemsToUpdate] = partitionItemsAddUpdate(
            modifiedItems
          )
          const pickProps = map(
            pick(['id', 'index', 'quantity', 'seller', 'options'])
          )

          // server mutation
          const updateItemsResponse = await mutateUpdateItems(
            pickProps(itemsToUpdate)
          )

          // server mutation
          const addItemsResponse = await addItems(pickProps(itemsToAdd))

          if (!isCurrent) {
            return
          }

          const newOrderForm = pathOr(
            path(['data', 'updateItems'], updateItemsResponse),
            ['data', 'addItem'],
            addItemsResponse
          )

          setUpdatingOrderForm(false)
          await updateOrderForm(newOrderForm)
        } catch (err) {
          // TODO: Toast error message into Alert
          console.error(err)

          if (!isCurrent) {
            return
          }

          // Rollback items and orderForm
          setUpdatingOrderForm(false)
          await updateOrderForm(prevOrderForm)

          showToast({
            message: intl.formatMessage({
              id: 'store/minicart.checkout-failure',
            }),
          })
        }
      }

      if (isOffline) {
        return
      }

      syncItemsWithServer()

      return () => {
        isCurrent = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, isOffline, showToast, addItems, mutateUpdateItems, modifiedItems]
  )

  const setContentOpen = isOpen => setMinicartOpen(isOpen)

  const handleClickButton = event => {
    if (!hideContent) {
      setContentOpen(!minicartState.isOpen)
    }
    event.persist()
  }

  const handleUpdateContentVisibility = () => {
    setContentOpen(false)
  }

  const handleClickProduct = detailUrl => {
    setContentOpen(false)
    navigate({
      to: detailUrl,
    })
  }

  const getFilteredItems = () => {
    return minicartItems.filter(shouldShowItem)
  }

  const itemsToShow = getFilteredItems()
  const totalItemsSum = arr =>
    arr.reduce((sum, product) => sum + product.quantity, 0)
  const quantity = showTotalItemsQty
    ? totalItemsSum(itemsToShow)
    : itemsToShow.length

  const isSizeLarge =
    (type && type === 'sidebar') ||
    mobile ||
    (window && window.innerWidth <= 480)

  const isOpen = pathOr(false, ['isOpen'], minicartState)

  const miniCartContent = (
    <MiniCartContent
      isSizeLarge={isSizeLarge}
      itemsToShow={itemsToShow}
      orderForm={{
        ...orderForm,
        items: minicartItems,
      }}
      loading={data.loading}
      showDiscount={showDiscount}
      labelMiniCartEmpty={labelMiniCartEmpty}
      labelButton={labelButtonFinishShopping}
      onClickProduct={handleClickProduct}
      onClickAction={handleUpdateContentVisibility}
      showShippingCost={showShippingCost}
      updatingOrderForm={isUpdatingOrderForm}
    />
  )

  const iconLabelClasses = classNames(
    `${styles.label} dn-m db-l t-action--small ${labelClasses}`,
    {
      pl6: quantity > 0,
      pl4: quantity <= 0,
    }
  )

  return (
    <aside className={`${styles.container} relative fr flex items-center`}>
      <div className="flex flex-column">
        <Button variation="tertiary" icon onClick={handleClickButton}>
          <span className="flex items-center">
            <span className={`relative ${iconClasses}`}>
              <IconCart size={iconSize} />
              {quantity > 0 && (
                <span
                  data-testid="item-qty"
                  className={`${styles.badge} c-on-emphasis absolute t-mini bg-emphasis br4 w1 h1 pa1 flex justify-center items-center lh-solid`}
                >
                  {quantity}
                </span>
              )}
            </span>
            {iconLabel && <span className={iconLabelClasses}>{iconLabel}</span>}
          </span>
        </Button>
        {!hideContent &&
          (isSizeLarge ? (
            <Sidebar
              quantity={quantity}
              iconSize={iconSize}
              onOutsideClick={handleUpdateContentVisibility}
              isOpen={isOpen}
            >
              {miniCartContent}
            </Sidebar>
          ) : (
            isOpen && (
              <Popup onOutsideClick={handleUpdateContentVisibility}>
                {miniCartContent}
              </Popup>
            )
          ))}
      </div>
    </aside>
  )
}

const withLinkStateUpdateItemsMutation = graphql(updateItemsMutation, {
  name: 'updateLinkStateItems',
  props: ({ updateLinkStateItems }) => ({
    updateLinkStateItems: items =>
      updateLinkStateItems({ variables: { items } }),
  }),
})

const withLinkStateUpdateOrderFormMutation = graphql(updateOrderFormMutation, {
  name: 'updateOrderForm',
  props: ({ updateOrderForm }) => ({
    updateOrderForm: orderForm => updateOrderForm({ variables: { orderForm } }),
  }),
})

const withLinkStateUpdateLocalItemStatusMutation = graphql(
  updateLocalItemStatusMutation,
  {
    name: 'updateLocalItemStatus',
  }
)

const withLinkStateSetIsOpenMutation = graphql(setMinicartOpenMutation, {
  name: 'setMinicartOpen',
  props: ({ setMinicartOpen }) => ({
    setMinicartOpen: isOpen => setMinicartOpen({ variables: { isOpen } }),
  }),
})

const EnhancedMinicart = compose(
  graphql(MINICART_QUERY, { options: { ssr: false } }),
  graphql(addToCart, { name: 'addToCartMutation' }),
  graphql(updateItems, { name: 'updateItemsMutation' }),
  withApollo,
  withLinkStateUpdateItemsMutation,
  withLinkStateUpdateOrderFormMutation,
  withLinkStateUpdateLocalItemStatusMutation,
  withLinkStateSetIsOpenMutation,
  injectIntl
)(MiniCart)

EnhancedMinicart.schema = {
  title: 'admin/editor.minicart.title',
  description: 'admin/editor.minicart.description',
  type: 'object',
  properties: {
    type: {
      title: 'admin/editor.minicart.type.title',
      type: 'string',
      default: 'popup',
      enum: ['popup', 'sidebar'],
      enumNames: [
        'admin/editor.minicart.type.popup',
        'admin/editor.minicart.type.sidebar',
      ],
      widget: {
        'ui:widget': 'radio',
        'ui:options': {
          inline: true,
        },
      },
      isLayout: true,
    },
    showDiscount: {
      title: 'admin/editor.minicart.showDiscount.title',
      type: 'boolean',
      isLayout: true,
    },
    labelMiniCartEmpty: {
      title: 'admin/editor.minicart.labelMiniCartEmpty.title',
      type: 'string',
      isLayout: false,
    },
    labelButtonFinishShopping: {
      title: 'admin/editor.minicart.labelButtonFinishShopping.title',
      type: 'string',
      isLayout: false,
    },
  },
}

export default EnhancedMinicart
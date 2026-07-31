class Order
  attr_reader :items

  def initialize
    @items = []
  end

  def add(name, price)
    @items << { name: name, price: price }
  end

  def total
    subtotal = @items.sum { |item| item[:price] }
    Tax.apply(subtotal)
  end
end
